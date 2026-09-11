package helper

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mednov-ai/awg-control/internal/configdoc"
)

const maxCommandOutput = 16 * 1024 * 1024

var (
	containerIDPattern = regexp.MustCompile(`^[a-f0-9]{12,64}$`)
	interfacePattern   = regexp.MustCompile(`^[A-Za-z0-9_=+.-]{1,32}$`)
	fileModePattern    = regexp.MustCompile(`^[0-7]{3,4}$`)
	numericIDPattern   = regexp.MustCompile(`^(0|[1-9][0-9]{0,9})$`)
)

type commandRunner interface {
	Run(ctx context.Context, name string, args []string, input []byte, maxOutput int) ([]byte, error)
}

type execRunner struct{}

type limitedBuffer struct {
	buffer bytes.Buffer
	limit  int
}

func (b *limitedBuffer) Write(data []byte) (int, error) {
	if b.buffer.Len()+len(data) > b.limit {
		return 0, errors.New("command output exceeded limit")
	}
	return b.buffer.Write(data)
}

func (execRunner) Run(ctx context.Context, name string, args []string, input []byte, maxOutput int) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	if input != nil {
		command.Stdin = bytes.NewReader(input)
	}
	stdout := &limitedBuffer{limit: maxOutput}
	stderr := &limitedBuffer{limit: 64 * 1024}
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		return nil, errors.New("fixed runtime command failed")
	}
	return stdout.buffer.Bytes(), nil
}

type PeerStats struct {
	PublicKey       string  `json:"publicKey"`
	RXBytes         uint64  `json:"rxBytes"`
	TXBytes         uint64  `json:"txBytes"`
	LastHandshakeAt *string `json:"lastHandshakeAt"`
}

type DockerRuntime struct {
	runner  commandRunner
	timeout time.Duration
}

func NewDockerRuntime() *DockerRuntime {
	return &DockerRuntime{runner: execRunner{}, timeout: 15 * time.Second}
}

func (r *DockerRuntime) docker(args []string, input []byte, max int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), r.timeout)
	defer cancel()
	return r.runner.Run(ctx, "docker", args, input, max)
}

func (r *DockerRuntime) exec(containerID string, command ...string) ([]byte, error) {
	if !containerIDPattern.MatchString(containerID) {
		return nil, errors.New("invalid stored container reference")
	}
	args := append([]string{"exec", "--", containerID}, command...)
	return r.docker(args, nil, maxCommandOutput)
}

func (r *DockerRuntime) execInput(containerID string, input []byte, command ...string) ([]byte, error) {
	if !containerIDPattern.MatchString(containerID) {
		return nil, errors.New("invalid stored container reference")
	}
	args := append([]string{"exec", "-i", "--", containerID}, command...)
	return r.docker(args, input, maxCommandOutput)
}

func fingerprint(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func opaque(prefix, value string) string {
	sum := sha256.Sum256([]byte(value))
	return prefix + "-" + hex.EncodeToString(sum[:8])
}

type adapterProfile struct {
	adapter         string
	protocolVersion string
	displayName     string
	clientFields    map[string]struct{}
	supported       bool
}

func stringSet(values ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[strings.ToLower(value)] = struct{}{}
	}
	return result
}

var (
	awg2ClientFields = stringSet(
		"Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
		"I1", "I2", "I3", "I4", "I5",
	)
	awg2RequiredFields = stringSet("Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4")
	awg3ClientFields   = stringSet(
		"Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
		"HeaderProtectionKey", "ContentPaddingAddition", "RekeyAfterTime", "RekeyTimeout",
		"RejectAfterTime", "KeepaliveTimeout", "MaxHandshakeAttempts", "RandomTrailers", "DisableCookies",
		"I1", "I2", "I3", "I4", "I5",
	)
	awg31RequiredFields = stringSet(
		"Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
		"HeaderProtectionKey", "ContentPaddingAddition", "RandomTrailers", "DisableCookies",
	)
	commentedClientFields = stringSet("I1", "I2", "I3", "I4", "I5")
)

func lowerValues(values map[string]string) map[string]string {
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[strings.ToLower(key)] = value
	}
	return result
}

func hasAllFields(values map[string]string, required map[string]struct{}) bool {
	for key := range required {
		if strings.TrimSpace(values[key]) == "" {
			return false
		}
	}
	return true
}

func profileForConfig(binaryName string, document *configdoc.Document) adapterProfile {
	markerFields := stringSet(
		"Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
		"HeaderProtectionKey", "ContentPaddingAddition", "RandomTrailers", "DisableCookies",
	)
	values := lowerValues(document.InterfaceValues(markerFields))
	if values["headerprotectionkey"] != "" {
		version := "3.0"
		supported := false
		if values["randomtrailers"] != "" && values["disablecookies"] != "" {
			version = "3.1"
			supported = hasAllFields(values, awg31RequiredFields)
		}
		return adapterProfile{
			adapter: "awg3", protocolVersion: version, displayName: "AmneziaWG " + version,
			clientFields: awg3ClientFields, supported: supported,
		}
	}
	if binaryName == "awg" || values["jc"] != "" {
		return adapterProfile{
			adapter: "awg2", protocolVersion: "2", displayName: "AmneziaWG 2",
			clientFields: awg2ClientFields,
			supported:    hasAllFields(values, awg2RequiredFields),
		}
	}
	return adapterProfile{
		adapter: "amneziawg-legacy", protocolVersion: "legacy", displayName: "AmneziaWG Legacy",
		clientFields: map[string]struct{}{}, supported: binaryName == "wg",
	}
}

func (r *DockerRuntime) Discover(existing []Instance) ([]Instance, error) {
	output, err := r.docker([]string{"ps", "--no-trunc", "--format={{.ID}}"}, nil, 2*1024*1024)
	if err != nil {
		return nil, errors.New("docker discovery unavailable")
	}
	known := make(map[string]Instance)
	for _, instance := range existing {
		known[instance.ContainerID+"/"+instance.InterfaceName] = instance
	}
	instances := make([]Instance, 0)
	for _, containerID := range strings.Fields(string(output)) {
		if !containerIDPattern.MatchString(containerID) {
			continue
		}
		binaryName, interfaces := r.interfaces(containerID)
		for _, interfaceName := range interfaces {
			configPath, writable, data := r.findConfig(containerID, interfaceName)
			if configPath == "" || len(data) == 0 {
				continue
			}
			serverPublicKey := strings.TrimSpace(r.safeExec(containerID, binaryName, "show", interfaceName, "public-key"))
			udpPort := r.udpPort(containerID)
			instance, ok := known[containerID+"/"+interfaceName]
			if !ok {
				id, uuidErr := UUIDv7()
				if uuidErr != nil {
					return nil, uuidErr
				}
				instance.ID = id
			}
			document, parseErr := configdoc.Parse(data)
			clientFields := map[string]string{}
			profile := adapterProfile{adapter: "amneziawg-legacy", protocolVersion: "unknown", displayName: "Unsupported AmneziaWG"}
			if parseErr == nil {
				profile = profileForConfig(binaryName, document)
				clientFields = document.InterfaceValuesWithCommented(profile.clientFields, commentedClientFields)
			}
			managed := writable && parseErr == nil && profile.supported && serverPublicKey != "" && udpPort > 0
			instance.DisplayName = profile.displayName + " / " + interfaceName
			instance.Adapter = profile.adapter
			instance.ProtocolVersion = profile.protocolVersion
			instance.ContainerID = containerID
			instance.ContainerRef = opaque("container", containerID)
			instance.InterfaceName = interfaceName
			instance.ConfigPath = configPath
			instance.ConfigRef = opaque("config", containerID+":"+configPath)
			instance.Binary = binaryName
			instance.UDPPort = udpPort
			instance.ServerPublicKey = serverPublicKey
			instance.SourceFingerprint = fingerprint(data)
			instance.ClientFields = clientFields
			instance.Capabilities = Capabilities{
				Stats: true, Create: managed, Suspend: managed, Resume: managed, Revoke: managed,
				MetadataUpdate: false,
			}
			instances = append(instances, instance)
		}
	}
	return instances, nil
}

func (r *DockerRuntime) interfaces(containerID string) (string, []string) {
	for _, binaryName := range []string{"awg", "wg"} {
		output, err := r.exec(containerID, binaryName, "show", "interfaces")
		if err != nil {
			continue
		}
		interfaces := make([]string, 0)
		for _, name := range strings.Fields(string(output)) {
			if interfacePattern.MatchString(name) {
				interfaces = append(interfaces, name)
			}
		}
		if len(interfaces) > 0 {
			return binaryName, interfaces
		}
	}
	return "", nil
}

func (r *DockerRuntime) findConfig(containerID, interfaceName string) (string, bool, []byte) {
	if !interfacePattern.MatchString(interfaceName) {
		return "", false, nil
	}
	candidates := []string{
		"/opt/amnezia/awg/" + interfaceName + ".conf",
		"/opt/amnezia/awg2/" + interfaceName + ".conf",
		"/etc/wireguard/" + interfaceName + ".conf",
		"/etc/amnezia/amneziawg/" + interfaceName + ".conf",
		"/config/" + interfaceName + ".conf",
	}
	for _, candidate := range candidates {
		if _, err := r.exec(containerID, "test", "-r", candidate); err != nil {
			continue
		}
		data, err := r.exec(containerID, "cat", candidate)
		if err != nil || len(data) == 0 {
			continue
		}
		_, writeErr := r.exec(containerID, "test", "-w", candidate)
		return candidate, writeErr == nil, data
	}
	return "", false, nil
}

func (r *DockerRuntime) safeExec(containerID string, command ...string) string {
	output, err := r.exec(containerID, command...)
	if err != nil {
		return ""
	}
	return string(output)
}

func (r *DockerRuntime) udpPort(containerID string) int {
	output, err := r.docker([]string{"inspect", "--format={{json .NetworkSettings.Ports}}", containerID}, nil, 1024*1024)
	if err != nil {
		return 0
	}
	var bindings map[string][]struct {
		HostPort string `json:"HostPort"`
	}
	if json.Unmarshal(output, &bindings) != nil {
		return 0
	}
	ports := make([]int, 0)
	for key, values := range bindings {
		if !strings.HasSuffix(key, "/udp") {
			continue
		}
		for _, value := range values {
			portValue, parseErr := strconv.Atoi(value.HostPort)
			if parseErr == nil && portValue > 0 && portValue <= 65535 {
				ports = append(ports, portValue)
			}
		}
	}
	if len(ports) == 0 {
		return 0
	}
	sort.Ints(ports)
	return ports[0]
}

func (r *DockerRuntime) ReadConfig(instance Instance) ([]byte, error) {
	if !validInstance(instance) {
		return nil, errors.New("stored instance metadata is invalid")
	}
	data, err := r.exec(instance.ContainerID, "cat", instance.ConfigPath)
	if err != nil {
		return nil, errors.New("read instance configuration failed")
	}
	return data, nil
}

func (r *DockerRuntime) GenerateKeyPair(instance Instance) (privateKey, publicKey string, err error) {
	privateData, err := r.exec(instance.ContainerID, instance.Binary, "genkey")
	if err != nil {
		return "", "", errors.New("client key generation failed")
	}
	privateKey = strings.TrimSpace(string(privateData))
	publicData, err := r.execInput(instance.ContainerID, []byte(privateKey+"\n"), instance.Binary, "pubkey")
	if err != nil {
		return "", "", errors.New("client public key derivation failed")
	}
	publicKey = strings.TrimSpace(string(publicData))
	if !validWireGuardKey(privateKey) || !validWireGuardKey(publicKey) {
		return "", "", errors.New("key generator returned an invalid key")
	}
	return privateKey, publicKey, nil
}

func (r *DockerRuntime) Stats(instance Instance) ([]PeerStats, error) {
	if !validInstance(instance) {
		return nil, errors.New("stored instance metadata is invalid")
	}
	transfers, err := r.exec(instance.ContainerID, instance.Binary, "show", instance.InterfaceName, "transfer")
	if err != nil {
		return nil, errors.New("read transfer counters failed")
	}
	handshakes, err := r.exec(instance.ContainerID, instance.Binary, "show", instance.InterfaceName, "latest-handshakes")
	if err != nil {
		return nil, errors.New("read handshake counters failed")
	}
	handshakeByKey := make(map[string]int64)
	for _, line := range strings.Split(strings.TrimSpace(string(handshakes)), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || !validWireGuardKey(fields[0]) {
			continue
		}
		value, parseErr := strconv.ParseInt(fields[1], 10, 64)
		if parseErr == nil {
			handshakeByKey[fields[0]] = value
		}
	}
	result := make([]PeerStats, 0)
	for _, line := range strings.Split(strings.TrimSpace(string(transfers)), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 || !validWireGuardKey(fields[0]) {
			continue
		}
		rx, rxErr := strconv.ParseUint(fields[1], 10, 64)
		tx, txErr := strconv.ParseUint(fields[2], 10, 64)
		if rxErr != nil || txErr != nil {
			continue
		}
		var timestamp *string
		if seconds := handshakeByKey[fields[0]]; seconds > 0 {
			value := time.Unix(seconds, 0).UTC().Format(time.RFC3339Nano)
			timestamp = &value
		}
		result = append(result, PeerStats{PublicKey: fields[0], RXBytes: rx, TXBytes: tx, LastHandshakeAt: timestamp})
	}
	return result, nil
}

func (r *DockerRuntime) Apply(instance Instance, operationID string, original, updated []byte, expectedPublicKey string, shouldExist bool) error {
	if !validInstance(instance) || !safeID(operationID) {
		return errors.New("invalid transaction metadata")
	}
	mode, owner, err := r.configurationMetadata(instance)
	if err != nil {
		return err
	}
	remoteDir, remoteNew, remoteStripped := transactionPaths("awg-control-", operationID, instance.InterfaceName)
	cleanup := func() {
		_, _ = r.exec(instance.ContainerID, "rm", "-f", remoteNew, remoteStripped)
		_, _ = r.exec(instance.ContainerID, "rmdir", remoteDir)
	}
	defer cleanup()
	if _, err := r.exec(instance.ContainerID, "mkdir", "-m", "700", remoteDir); err != nil {
		return errors.New("prepare transaction workspace failed")
	}
	if err := r.copyTo(instance.ContainerID, remoteNew, updated); err != nil {
		return err
	}
	stripped, err := r.exec(instance.ContainerID, quickBinary(instance), "strip", remoteNew)
	if err != nil || len(stripped) == 0 {
		return errors.New("adapter validation failed")
	}
	if err := r.copyTo(instance.ContainerID, remoteStripped, stripped); err != nil {
		return err
	}
	if _, err := r.exec(instance.ContainerID, "chmod", mode, remoteNew); err != nil {
		return errors.New("preserve configuration mode failed")
	}
	if _, err := r.exec(instance.ContainerID, "chown", owner, remoteNew); err != nil {
		return errors.New("preserve configuration ownership failed")
	}
	if _, err := r.exec(instance.ContainerID, "mv", "-f", remoteNew, instance.ConfigPath); err != nil {
		return errors.New("atomic configuration replace failed")
	}
	if _, err := r.exec(instance.ContainerID, instance.Binary, "syncconf", instance.InterfaceName, remoteStripped); err != nil {
		if rollbackErr := r.rollback(instance, operationID, original, mode, owner); rollbackErr != nil {
			return errors.New("apply and rollback failed")
		}
		return errors.New("apply failed; original configuration restored")
	}
	peers, err := r.exec(instance.ContainerID, instance.Binary, "show", instance.InterfaceName, "peers")
	if err != nil || containsKey(string(peers), expectedPublicKey) != shouldExist {
		if rollbackErr := r.rollback(instance, operationID, original, mode, owner); rollbackErr != nil {
			return errors.New("verification and rollback failed")
		}
		return errors.New("verification failed; original configuration restored")
	}
	return nil
}

func (r *DockerRuntime) rollback(instance Instance, operationID string, original []byte, mode, owner string) error {
	remoteDir, remoteOriginal, remoteStripped := transactionPaths("awg-control-rollback-", operationID, instance.InterfaceName)
	defer func() {
		_, _ = r.exec(instance.ContainerID, "rm", "-f", remoteOriginal, remoteStripped)
		_, _ = r.exec(instance.ContainerID, "rmdir", remoteDir)
	}()
	if _, err := r.exec(instance.ContainerID, "mkdir", "-m", "700", remoteDir); err != nil {
		return errors.New("prepare rollback workspace failed")
	}
	if err := r.copyTo(instance.ContainerID, remoteOriginal, original); err != nil {
		return err
	}
	stripped, err := r.exec(instance.ContainerID, quickBinary(instance), "strip", remoteOriginal)
	if err != nil {
		return err
	}
	if err := r.copyTo(instance.ContainerID, remoteStripped, stripped); err != nil {
		return err
	}
	if _, err := r.exec(instance.ContainerID, "chmod", mode, remoteOriginal); err != nil {
		return errors.New("preserve rollback configuration mode failed")
	}
	if _, err := r.exec(instance.ContainerID, "chown", owner, remoteOriginal); err != nil {
		return errors.New("preserve rollback configuration ownership failed")
	}
	if _, err := r.exec(instance.ContainerID, "mv", "-f", remoteOriginal, instance.ConfigPath); err != nil {
		return err
	}
	_, err = r.exec(instance.ContainerID, instance.Binary, "syncconf", instance.InterfaceName, remoteStripped)
	return err
}

func (r *DockerRuntime) configurationMetadata(instance Instance) (mode, owner string, err error) {
	data, err := r.exec(instance.ContainerID, "stat", "-c", "%a:%u:%g", instance.ConfigPath)
	if err != nil {
		return "", "", errors.New("read configuration metadata failed")
	}
	parts := strings.Split(strings.TrimSpace(string(data)), ":")
	if len(parts) != 3 || !fileModePattern.MatchString(parts[0]) || !numericIDPattern.MatchString(parts[1]) || !numericIDPattern.MatchString(parts[2]) {
		return "", "", errors.New("configuration metadata is invalid")
	}
	return parts[0], parts[1] + ":" + parts[2], nil
}

func (r *DockerRuntime) copyTo(containerID, remotePath string, data []byte) error {
	temporary, err := os.CreateTemp("", "awg-control-config-")
	if err != nil {
		return errors.New("create protected temporary file failed")
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if _, err := r.docker([]string{"cp", name, containerID + ":" + remotePath}, nil, 64*1024); err != nil {
		return errors.New("copy protected configuration failed")
	}
	return nil
}

func validInstance(instance Instance) bool {
	return safeID(instance.ID) && containerIDPattern.MatchString(instance.ContainerID) && interfacePattern.MatchString(instance.InterfaceName) &&
		(instance.Binary == "wg" || instance.Binary == "awg") && path.IsAbs(instance.ConfigPath) && strings.HasSuffix(instance.ConfigPath, ".conf")
}

func quickBinary(instance Instance) string {
	if instance.Binary == "awg" {
		return "awg-quick"
	}
	return "wg-quick"
}

func transactionPaths(prefix, operationID, interfaceName string) (directory, configuration, stripped string) {
	directory = path.Join("/tmp", prefix+operationID)
	configuration = path.Join(directory, interfaceName+".conf")
	stripped = path.Join(directory, interfaceName+".stripped.conf")
	return directory, configuration, stripped
}

func validWireGuardKey(value string) bool {
	if len(value) != 44 || !strings.HasSuffix(value, "=") {
		return false
	}
	for _, character := range value[:43] {
		if !(character >= 'a' && character <= 'z') && !(character >= 'A' && character <= 'Z') && !(character >= '0' && character <= '9') && character != '+' && character != '/' {
			return false
		}
	}
	return true
}

func containsKey(output, publicKey string) bool {
	for _, value := range strings.Fields(output) {
		if value == publicKey {
			return true
		}
	}
	return false
}

func validEndpointHost(value string) bool {
	if net.ParseIP(strings.Trim(value, "[]")) != nil {
		return true
	}
	if len(value) < 1 || len(value) > 253 {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) < 1 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, character := range label {
			if !(character >= 'a' && character <= 'z') && !(character >= 'A' && character <= 'Z') && !(character >= '0' && character <= '9') && character != '-' {
				return false
			}
		}
	}
	return true
}

func hostPort(host string, portValue int) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		host = "[" + host + "]"
	}
	return net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(portValue))
}

func buildClientConfig(instance Instance, privateKey, addressCIDR, endpointHost string) (string, error) {
	if !validEndpointHost(endpointHost) || instance.UDPPort < 1 || !validWireGuardKey(instance.ServerPublicKey) {
		return "", errors.New("client template is unavailable")
	}
	var builder strings.Builder
	builder.WriteString("[Interface]\nPrivateKey = ")
	builder.WriteString(privateKey)
	builder.WriteString("\nAddress = ")
	builder.WriteString(addressCIDR)
	builder.WriteString("\nDNS = 1.1.1.1\n")
	if instance.Adapter == "awg3" {
		builder.WriteString("MTU = 1280\n")
	}
	keys := make([]string, 0, len(instance.ClientFields))
	for key := range instance.ClientFields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteString(" = ")
		builder.WriteString(instance.ClientFields[key])
		builder.WriteByte('\n')
	}
	builder.WriteString("\n[Peer]\nPublicKey = ")
	builder.WriteString(instance.ServerPublicKey)
	builder.WriteString("\nEndpoint = ")
	builder.WriteString(hostPort(endpointHost, instance.UDPPort))
	builder.WriteString("\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n")
	return builder.String(), nil
}

func parseCIDR(value string) bool {
	_, network, err := net.ParseCIDR(value)
	return err == nil && network.String() == value
}

func readAllLimited(reader io.Reader, maximum int) ([]byte, error) {
	return io.ReadAll(io.LimitReader(reader, int64(maximum)))
}

var _ = fmt.Sprintf
