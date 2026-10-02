// Package relay deliberately has no dependency on the VPN helper runtime.
package relay

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"

	"github.com/mednov-ai/awg-control/internal/protocol"
	"github.com/mednov-ai/awg-control/internal/version"
)

const ProtocolVersion = "1.1"
const Unit = "awg-control-relay.service"
const ConfigPath = "/etc/awg-control-relay/nginx.conf"
const UnitPath = "/etc/systemd/system/awg-control-relay.service"
const StatePath = "/var/lib/awg-control-relay"

var operationPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
var uuidPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var actions = map[protocol.Action]bool{"status": true, "install": true, "update": true, "apply": true, "disable": true, "remove": true, "uninstall": true}

type Route struct {
	ID           string `json:"id"`
	ListenPort   int    `json:"listenPort"`
	UpstreamIPv4 string `json:"upstreamIpv4"`
	UpstreamPort int    `json:"upstreamPort"`
	Enabled      bool   `json:"enabled"`
}
type Status struct {
	Installed         bool    `json:"installed"`
	Active            bool    `json:"active"`
	SourceFingerprint string  `json:"sourceFingerprint"`
	HelperVersion     string  `json:"helperVersion"`
	ProtocolVersion   string  `json:"protocolVersion"`
	Routes            []Route `json:"routes"`
}
type Params struct {
	ExpectedFingerprint string `json:"expectedFingerprint"`
	Route               *Route `json:"route,omitempty"`
	RouteID             string `json:"routeId,omitempty"`
}
type fileSnapshot struct {
	Exists bool   `json:"exists"`
	Data   []byte `json:"data"`
}
type snapshot struct {
	Config  fileSnapshot `json:"config"`
	Unit    fileSnapshot `json:"unit"`
	Routes  fileSnapshot `json:"routes"`
	Active  bool         `json:"active"`
	Enabled bool         `json:"enabled"`
}
type journal struct {
	Hash      string   `json:"hash"`
	Status    string   `json:"status"`
	Before    snapshot `json:"before"`
	Result    *Status  `json:"result,omitempty"`
	ErrorCode string   `json:"errorCode,omitempty"`
}

type Runtime interface {
	Validate(string) error
	Transition(installed, previouslyActive bool) error
	Active() bool
	Verify([]Route) error
	Enabled() bool
	SetEnabled(bool) error
	Reload() error
}
type Service struct {
	Root    string
	Runtime Runtime
}

func NewService(root string, runtime Runtime) *Service { return &Service{Root: root, Runtime: runtime} }
func (s *Service) path(path string) string             { return filepath.Join(s.Root, path) }

func DecodeRequest(reader io.Reader) (protocol.Request, error) {
	data, err := io.ReadAll(io.LimitReader(reader, protocol.MaxRequestBytes+1))
	if err != nil || len(data) > protocol.MaxRequestBytes {
		return protocol.Request{}, errors.New("invalid request size")
	}
	var request protocol.Request
	if err := protocol.DecodeParameters(data, &request); err != nil {
		return request, err
	}
	if (request.ProtocolVersion != ProtocolVersion && request.ProtocolVersion != "1.0") || !operationPattern.MatchString(request.RequestID) || !operationPattern.MatchString(request.OperationID) || !actions[request.Action] {
		return request, errors.New("invalid relay request")
	}
	if !bytes.HasPrefix(bytes.TrimSpace(request.Parameters), []byte("{")) {
		return request, errors.New("parameters must be an object")
	}
	return request, nil
}
func validRoute(r Route) bool {
	ip := net.ParseIP(r.UpstreamIPv4)
	return uuidPattern.MatchString(r.ID) && r.ListenPort >= 1024 && r.ListenPort <= 65535 && r.UpstreamPort >= 1 && r.UpstreamPort <= 65535 && ip != nil && ip.To4() != nil && ip.String() == r.UpstreamIPv4 && ip.IsGlobalUnicast() && !ip.IsPrivate()
}
func Render(routes []Route) ([]byte, error) {
	routes = append([]Route(nil), routes...)
	sort.Slice(routes, func(i, j int) bool { return routes[i].ListenPort < routes[j].ListenPort })
	var b strings.Builder
	b.WriteString("# Managed by AWG Control; dedicated UDP relay only.\nload_module /usr/lib/nginx/modules/ngx_stream_module.so;\nworker_processes 1;\nworker_shutdown_timeout 5s;\npid /run/awg-control-relay/nginx.pid;\nerror_log stderr warn;\nevents { worker_connections 4096; }\nstream {\n  access_log off;\n")
	ids := map[string]bool{}
	ports := map[int]bool{}
	for _, r := range routes {
		if !validRoute(r) || ids[r.ID] || ports[r.ListenPort] {
			return nil, errors.New("invalid or conflicting route")
		}
		ids[r.ID] = true
		ports[r.ListenPort] = true
		if !r.Enabled {
			continue
		}
		fmt.Fprintf(&b, "  server {\n    listen 0.0.0.0:%d udp reuseport;\n    proxy_pass %s:%d;\n    proxy_timeout 120s;\n    proxy_requests 0;\n    proxy_protocol off;\n  }\n", r.ListenPort, r.UpstreamIPv4, r.UpstreamPort)
	}
	b.WriteString("}\n")
	return []byte(b.String()), nil
}

const serviceUnit = `[Unit]
Description=AWG Control dedicated UDP relay
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
DynamicUser=yes
RuntimeDirectory=awg-control-relay
RuntimeDirectoryMode=0700
ExecStart=/usr/sbin/nginx -c /etc/awg-control-relay/nginx.conf -p /run/awg-control-relay/ -g "daemon off;"
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_UNIX
ReadWritePaths=/run/awg-control-relay
CapabilityBoundingSet=
[Install]
WantedBy=multi-user.target
`

func readFile(path string) (fileSnapshot, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return fileSnapshot{}, nil
	}
	if err != nil {
		return fileSnapshot{}, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fileSnapshot{}, errors.New("unsafe relay file")
	}
	data, err := os.ReadFile(path)
	return fileSnapshot{Exists: true, Data: data}, err
}
func writeFile(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".relay-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func saveJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeFile(path, data, 0o600)
}
func restoreFile(path string, f fileSnapshot, mode os.FileMode) error {
	if f.Exists {
		return writeFile(path, f.Data, mode)
	}
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
func (s *Service) capture() (snapshot, error) {
	var snap snapshot
	var err error
	snap.Config, err = readFile(s.path(ConfigPath))
	if err != nil {
		return snap, err
	}
	snap.Unit, err = readFile(s.path(UnitPath))
	if err != nil {
		return snap, err
	}
	snap.Routes, err = readFile(s.path(StatePath + "/routes.json"))
	if err != nil {
		return snap, err
	}
	snap.Active = s.Runtime.Active()
	snap.Enabled = s.Runtime.Enabled()
	return snap, nil
}
func fingerprint(snap snapshot) string {
	snap.Active = false
	snap.Enabled = false
	data, _ := json.Marshal(snap)
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}
func (s *Service) status() (Status, error) {
	snap, err := s.capture()
	if err != nil {
		return Status{}, err
	}
	routes := []Route{}
	if snap.Routes.Exists {
		if err = json.Unmarshal(snap.Routes.Data, &routes); err != nil {
			return Status{}, err
		}
		if _, err = Render(routes); err != nil {
			return Status{}, err
		}
	}
	return Status{Installed: snap.Unit.Exists && snap.Config.Exists, Active: snap.Active && s.Runtime.Verify(routes) == nil, SourceFingerprint: fingerprint(snap), HelperVersion: version.Version, ProtocolVersion: ProtocolVersion, Routes: routes}, nil
}
func (s *Service) rollback(before snapshot) error {
	// Stop the dedicated service before restoring or removing its owned files.
	if err := s.Runtime.Transition(false, false); err != nil {
		return err
	}
	if err := restoreFile(s.path(ConfigPath), before.Config, 0o644); err != nil {
		return err
	}
	if err := restoreFile(s.path(UnitPath), before.Unit, 0o644); err != nil {
		return err
	}
	if err := restoreFile(s.path(StatePath+"/routes.json"), before.Routes, 0o600); err != nil {
		return err
	}
	if err := s.Runtime.Reload(); err != nil {
		return err
	}
	if before.Unit.Exists && before.Config.Exists && before.Active {
		if err := s.Runtime.Transition(true, false); err != nil {
			return err
		}
	}
	return s.Runtime.SetEnabled(before.Enabled)
}
func (s *Service) recover() error {
	paths, err := filepath.Glob(s.path(StatePath + "/journal/*.json"))
	if err != nil {
		return err
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var j journal
		if err = json.Unmarshal(data, &j); err != nil {
			return err
		}
		if j.Status == "pending" {
			if err = s.rollback(j.Before); err != nil {
				return err
			}
			j.Status = "failed"
			j.ErrorCode = "RELAY_INTERRUPTED_ROLLED_BACK"
			if err = saveJSON(path, j); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Service) Handle(request protocol.Request) protocol.Response {
	fail := func(code string) protocol.Response {
		return protocol.Failure(request.RequestID, code, "Relay operation failed; inspect safe status and operation metadata", false)
	}
	if !actions[request.Action] || !operationPattern.MatchString(request.OperationID) {
		return fail("INVALID_REQUEST")
	}
	var params Params
	if request.Action == "status" {
		var empty struct{}
		if err := protocol.DecodeParameters(request.Parameters, &empty); err != nil {
			return fail("INVALID_REQUEST")
		}
	} else {
		if err := protocol.DecodeParameters(request.Parameters, &params); err != nil || (request.Action != "status" && !hashPattern.MatchString(params.ExpectedFingerprint)) {
			return fail("INVALID_REQUEST")
		}
		if request.Action == "apply" {
			if params.Route == nil || !validRoute(*params.Route) || params.RouteID != "" {
				return fail("INVALID_REQUEST")
			}
		} else if request.Action == "disable" || request.Action == "remove" {
			if !uuidPattern.MatchString(params.RouteID) || params.Route != nil {
				return fail("INVALID_REQUEST")
			}
		} else if params.Route != nil || params.RouteID != "" {
			return fail("INVALID_REQUEST")
		}
	}
	if err := os.MkdirAll(s.path(StatePath+"/journal"), 0o700); err != nil {
		return fail("RELAY_STATE_FAILED")
	}
	lock, err := os.OpenFile(s.path(StatePath+"/lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return fail("RELAY_STATE_FAILED")
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fail("RELAY_BUSY")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	if request.Action != "status" {
		if err = s.recover(); err != nil {
			return fail("RELAY_ROLLBACK_FAILED")
		}
	} else {
		paths, _ := filepath.Glob(s.path(StatePath + "/journal/*.json"))
		for _, path := range paths {
			data, readErr := os.ReadFile(path)
			var j journal
			if readErr != nil || json.Unmarshal(data, &j) != nil {
				return fail("RELAY_STATE_FAILED")
			}
			if j.Status == "pending" {
				return fail("RELAY_RECOVERY_REQUIRED")
			}
		}
	}
	if request.Action == "status" {
		var p struct{}
		if err = protocol.DecodeParameters(request.Parameters, &p); err != nil {
			return fail("INVALID_REQUEST")
		}
		status, err := s.status()
		if err != nil {
			return fail("RELAY_STATE_FAILED")
		}
		return protocol.Success(request.RequestID, status)
	}
	requestHash := sha256.Sum256(append([]byte(request.Action+":"), request.Parameters...))
	hash := hex.EncodeToString(requestHash[:])
	nameHash := sha256.Sum256([]byte(request.OperationID))
	journalPath := s.path(StatePath + "/journal/" + hex.EncodeToString(nameHash[:]) + ".json")
	existing, err := readFile(journalPath)
	if err != nil {
		return fail("RELAY_STATE_FAILED")
	}
	if existing.Exists {
		var j journal
		if err = json.Unmarshal(existing.Data, &j); err != nil {
			return fail("RELAY_STATE_FAILED")
		}
		if j.Hash != hash {
			return fail("IDEMPOTENCY_CONFLICT")
		}
		if j.Status == "succeeded" && j.Result != nil {
			return protocol.Success(request.RequestID, j.Result)
		}
		return fail(j.ErrorCode)
	}
	before, err := s.capture()
	if err != nil {
		return fail("RELAY_STATE_FAILED")
	}
	if fingerprint(before) != params.ExpectedFingerprint {
		return fail("SOURCE_FINGERPRINT_CONFLICT")
	}
	current, err := s.status()
	if err != nil {
		return fail("RELAY_STATE_FAILED")
	}
	routes := current.Routes
	if request.Action == "apply" || request.Action == "disable" || request.Action == "remove" {
		if !current.Installed {
			return fail("RELAY_NOT_INSTALLED")
		}
	}
	switch request.Action {
	case "apply":
		found := false
		for i, r := range routes {
			if r.ID == params.Route.ID {
				routes[i] = *params.Route
				found = true
			}
		}
		if !found {
			routes = append(routes, *params.Route)
		}
	case "disable", "remove":
		found := false
		next := []Route{}
		for _, r := range routes {
			if r.ID == params.RouteID {
				found = true
				if request.Action == "remove" {
					continue
				}
				r.Enabled = false
			}
			next = append(next, r)
		}
		if !found {
			return fail("RELAY_ROUTE_NOT_FOUND")
		}
		routes = next
	case "uninstall":
		routes = []Route{}
	}
	config, err := Render(routes)
	if err != nil {
		return fail("RELAY_ROUTE_CONFLICT")
	}
	installed := request.Action != "uninstall"
	if installed {
		validationDir, err := os.MkdirTemp(s.path(StatePath), "validation-")
		if err != nil {
			return fail("RELAY_STATE_FAILED")
		}
		defer os.RemoveAll(validationDir)
		candidate := filepath.Join(validationDir, "nginx.conf")
		if err = writeFile(candidate, config, 0o600); err != nil {
			return fail("RELAY_STATE_FAILED")
		}
		if err = s.Runtime.Validate(candidate); err != nil {
			return fail("RELAY_VALIDATION_FAILED")
		}
	}
	j := journal{Hash: hash, Status: "pending", Before: before}
	if err = saveJSON(journalPath, j); err != nil {
		return fail("RELAY_STATE_FAILED")
	}
	applyErr := func() error {
		if !installed {
			if err := s.Runtime.Transition(false, false); err != nil {
				return err
			}
			if err := restoreFile(s.path(ConfigPath), fileSnapshot{}, 0o644); err != nil {
				return err
			}
			if err := restoreFile(s.path(UnitPath), fileSnapshot{}, 0o644); err != nil {
				return err
			}
		} else {
			// awgctl has umask 077; DynamicUser needs traversal of this owned,
			// non-secret configuration directory. State/journals stay root-only.
			directory := s.path(filepath.Dir(ConfigPath))
			if err := os.MkdirAll(directory, 0o755); err != nil {
				return err
			}
			info, err := os.Lstat(directory)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return errors.New("unsafe relay config directory")
			}
			if err := os.Chmod(directory, 0o755); err != nil {
				return err
			}
			if err := writeFile(s.path(ConfigPath), config, 0o644); err != nil {
				return err
			}
			if err := writeFile(s.path(UnitPath), []byte(serviceUnit), 0o644); err != nil {
				return err
			}
		}
		if err := saveJSON(s.path(StatePath+"/routes.json"), routes); err != nil {
			return err
		}
		if installed {
			if err := s.Runtime.Transition(true, before.Active); err != nil {
				return err
			}
		} else if err := s.Runtime.Reload(); err != nil {
			return err
		}
		return nil
	}()
	if applyErr == nil {
		result, err := s.status()
		if err != nil || result.Installed != installed || (installed && !result.Active) {
			applyErr = errors.New("verification failed")
		} else {
			j.Result = &result
			j.Status = "succeeded"
			if err = saveJSON(journalPath, j); err == nil {
				return protocol.Success(request.RequestID, result)
			}
			applyErr = err
		}
	}
	if applyErr != nil {
		if err = s.rollback(before); err != nil {
			return fail("RELAY_ROLLBACK_FAILED")
		}
		j.Status = "failed"
		j.Result = nil
		j.ErrorCode = "RELAY_APPLY_FAILED"
		if err = saveJSON(journalPath, j); err != nil {
			return fail("RELAY_STATE_FAILED")
		}
		return fail(j.ErrorCode)
	}
	return fail("RELAY_APPLY_FAILED")
}
