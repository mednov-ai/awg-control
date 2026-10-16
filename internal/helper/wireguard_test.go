package helper

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/mednov-ai/awg-control/internal/configdoc"
	"github.com/mednov-ai/awg-control/internal/protocol"
)

func TestWireGuardIdentityRequiresRuntimeAndRejectsAWGMarkers(t *testing.T) {
	for _, test := range []struct {
		fields   string
		engine   bool
		writable bool
	}{
		{"", true, true}, {"", false, false},
		{"Jc = 0\n", true, false}, {"RandomTrailers = on\n", true, false},
		{"HeaderProtectionKey = synthetic\n", true, false}, {"I1 = synthetic\n", true, false},
		{"RekeyTimeout = 5\n", true, false},
	} {
		doc, _ := configdoc.Parse([]byte("[Interface]\nAddress = 10.12.0.1/24\n" + test.fields))
		profile := profileForConfig("wg", doc, test.engine)
		if (profile.adapter == "wireguard" && profile.supported) != test.writable {
			t.Fatal("unsafe protocol classification")
		}
	}
}

type networkProbeRunner struct {
	bindings string
	kind     string
	port     string
}

func (r networkProbeRunner) Run(_ context.Context, _ string, args []string, _ []byte, _ int) ([]byte, error) {
	if args[0] == "inspect" {
		return []byte(r.bindings), nil
	}
	if len(args) > 4 && args[3] == "ip" {
		return []byte(`[{"ifname":"wg0","linkinfo":{"info_kind":"` + r.kind + `"}}]`), nil
	}
	if len(args) > 6 && args[6] == "listen-port" {
		return []byte(r.port), nil
	}
	return nil, errors.New("unsupported synthetic probe")
}
func TestWireGuardRuntimeAndExactPortProbe(t *testing.T) {
	for _, test := range []struct {
		bindings string
		expected int
	}{
		{`{"51820/udp":[{"HostIp":"0.0.0.0","HostPort":"51822"}],"10000/udp":[{"HostIp":"0.0.0.0","HostPort":"10000"}]}`, 51822},
		{`{"51820/udp":[{"HostIp":"0.0.0.0","HostPort":"51822"},{"HostIp":"::","HostPort":"51822"}]}`, 51822},
		{`{"51820/udp":[{"HostIp":"127.0.0.1","HostPort":"51822"}]}`, 0},
		{`{"51820/udp":[{"HostIp":"0.0.0.0","HostPort":"51822"},{"HostIp":"0.0.0.0","HostPort":"51823"}]}`, 0},
		{`{"47300/udp":[{"HostIp":"0.0.0.0","HostPort":"47300"}]}`, 0},
	} {
		runtime := &DockerRuntime{runner: networkProbeRunner{bindings: test.bindings, kind: "wireguard", port: "51820"}}
		if got := runtime.udpPort(strings.Repeat("a", 64), "wg", "wg0"); got != test.expected {
			t.Fatalf("wrong mapping: got %d want %d", got, test.expected)
		}
		if !runtime.standardWireGuard(strings.Repeat("a", 64), "wg0") {
			t.Fatal("kernel WireGuard not confirmed")
		}
	}
	for _, kind := range []string{"tun", "amneziawg", "", "dummy"} {
		runtime := &DockerRuntime{runner: networkProbeRunner{kind: kind}}
		if runtime.standardWireGuard(strings.Repeat("a", 64), "wg0") {
			t.Fatal("non-WireGuard engine accepted")
		}
	}
}

func wireGuardStore(t *testing.T) (*Store, Instance) {
	store, instance := testStore(t)
	instance.Adapter = "wireguard"
	instance.ProtocolVersion = "wireguard"
	instance.Binary = "wg"
	if err := store.SaveInstances([]Instance{instance}); err != nil {
		t.Fatal(err)
	}
	return store, instance
}
func TestWireGuardOneTimeIssuanceAndPreviousProtocol(t *testing.T) {
	store, instance := wireGuardStore(t)
	runtime := &fakeRuntime{config: []byte("[Interface]\nAddress = 10.0.0.1/24\n")}
	service := NewService(store, runtime)
	request := createRequest(t, instance, "wg-create")
	rejected := service.Handle(request)
	if rejected.OK || rejected.Error.Code != "HELPER_INCOMPATIBLE" {
		t.Fatal("old protocol allowed WireGuard mutation")
	}
	request.ProtocolVersion = "1.1"
	response := service.Handle(request)
	if !response.OK {
		t.Fatal(response.Error.Code)
	}
	config := response.Result.(map[string]any)["clientConfig"].(string)
	for _, field := range []string{"MTU = 1280", "AllowedIPs = 0.0.0.0/0\n", "PersistentKeepalive = 25"} {
		if !strings.Contains(config, field) {
			t.Fatal("missing standard client field")
		}
	}
	for _, forbidden := range []string{"::/0", "HeaderProtectionKey", "Jc =", "PostUp"} {
		if strings.Contains(config, forbidden) {
			t.Fatal("nonstandard client field emitted")
		}
	}
	if replay := service.Handle(request); replay.OK || replay.Error.Code != "CONFIG_ALREADY_ISSUED" {
		t.Fatal("client secret reissued")
	}
	discovery := service.Handle(protocol.Request{ProtocolVersion: "1.0", Action: protocol.ActionDiscover, Parameters: json.RawMessage(`{}`)})
	if !discovery.OK || len(discovery.Result.(map[string]any)["instances"].([]map[string]any)) != 0 {
		t.Fatal("WireGuard leaked into old discovery contract")
	}
}
func TestWireGuardClientFieldsAreNeverCopied(t *testing.T) {
	_, instance := wireGuardStore(t)
	instance.ClientFields = map[string]string{"HeaderProtectionKey": "synthetic", "PostUp": "false", "PrivateKey": "server-secret-synthetic"}
	config, err := buildClientConfig(instance, fixturePrivateKey, "10.0.0.2/32", "vpn.example.test")
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"HeaderProtectionKey", "PostUp", "server-secret-synthetic"} {
		if strings.Contains(config, forbidden) {
			t.Fatal("server field copied")
		}
	}
}

func TestWireGuardOfflineQuotaAndLifecycle(t *testing.T) {
	store, instance := wireGuardStore(t)
	config := []byte("[Interface]\nAddress = 10.0.0.1/24\n[Peer]\nPublicKey = " + fixturePublicKey + "\nAllowedIPs = 10.0.0.2/32\n")
	instance.SourceFingerprint = fileFingerprint(config)
	if err := store.SaveInstances([]Instance{instance}); err != nil {
		t.Fatal(err)
	}
	limit := uint64(100)
	if err := store.SavePolicies([]Policy{{ConnectionID: "fixture-peer", InstanceID: instance.ID, PublicKey: fixturePublicKey, LimitBytes: &limit, UsedBytes: 90, UsageEpoch: "lifetime", Status: "active"}}); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeRuntime{config: config, stats: []PeerStats{{PublicKey: fixturePublicKey, RXBytes: 500, TXBytes: 500}}}
	service := NewService(store, runtime)
	if _, err := service.Enforce(); err != nil {
		t.Fatal(err)
	}
	// Baseline then a counter reset: only post-reset traffic counts, no underflow.
	runtime.stats[0].RXBytes = 5
	runtime.stats[0].TXBytes = 4
	if result, err := service.Enforce(); err != nil || result.Suspended != 0 {
		t.Fatal("counter reset or baseline failed")
	}
	runtime.stats[0].RXBytes = 7
	if result, err := service.Enforce(); err != nil || result.Suspended != 1 {
		t.Fatal("offline quota not enforced")
	}
	suspended, _ := store.Suspended()
	if len(suspended) != 1 || strings.Contains(string(runtime.config), fixturePublicKey) {
		t.Fatal("quota peer remained active")
	}
	// Resume/revoke use the same supported transaction and preserve reserved metadata.
	for index, action := range []protocol.Action{protocol.ActionEnable, protocol.ActionRevoke} {
		current, _ := store.Instance(instance.ID)
		parameters, _ := json.Marshal(mutationParameters{InstanceID: instance.ID, ExpectedFingerprint: current.SourceFingerprint, ConnectionID: "fixture-peer", PublicKey: fixturePublicKey})
		op := []string{"wg-resume", "wg-revoke"}[index]
		result := service.Handle(protocol.Request{ProtocolVersion: "1.1", RequestID: op, OperationID: op, Action: action, Parameters: parameters})
		if !result.OK {
			t.Fatal(result.Error.Code)
		}
	}
	if strings.Contains(string(runtime.config), fixturePublicKey) {
		t.Fatal("revoked peer remained active")
	}
}

func TestWireGuardOfflineExpiry(t *testing.T) {
	store, instance := wireGuardStore(t)
	config := []byte("[Interface]\nAddress = 10.0.0.1/24\n[Peer]\nPublicKey = " + fixturePublicKey + "\nAllowedIPs = 10.0.0.2/32\n")
	instance.SourceFingerprint = fileFingerprint(config)
	_ = store.SaveInstances([]Instance{instance})
	past := time.Now().UTC().Add(-time.Minute)
	_ = store.SavePolicies([]Policy{{ConnectionID: "expiry-peer", InstanceID: instance.ID, PublicKey: fixturePublicKey, ExpiresAt: &past, UsageEpoch: "lifetime", Status: "active"}})
	runtime := &fakeRuntime{config: config}
	if result, err := NewService(store, runtime).Enforce(); err != nil || result.Suspended != 1 {
		t.Fatal("offline expiry not enforced")
	}
}

func TestWireGuardAllocationRetainsSuspendedAddress(t *testing.T) {
	store, instance := wireGuardStore(t)
	reserved, _ := configdoc.Parse([]byte("[Interface]\n[Peer]\nPublicKey = SYNTHETIC-RESERVED\nAllowedIPs = 10.0.0.2/32\n"))
	section, err := reserved.RemovePeer("SYNTHETIC-RESERVED")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSuspended(map[string]SuspendedPeer{"reserved": {InstanceID: instance.ID, PublicKey: "SYNTHETIC-RESERVED", Section: *section}}); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeRuntime{config: []byte("[Interface]\nAddress = 10.0.0.1/24\n")}
	request := createRequest(t, instance, "wg-reservation")
	request.ProtocolVersion = "1.1"
	var params createParameters
	_ = json.Unmarshal(request.Parameters, &params)
	params.AddressCIDR = ""
	request.Parameters, _ = json.Marshal(params)
	response := NewService(store, runtime).Handle(request)
	if !response.OK {
		t.Fatal(response.Error.Code)
	}
	if response.Result.(map[string]any)["addressCidr"] != "10.0.0.3/32" {
		t.Fatal("suspended address reused")
	}
	if strings.Contains(string(runtime.config), "SYNTHETIC-RESERVED") {
		t.Fatal("allocation restored suspended peer to runtime")
	}
}

type wireGuardApplyRunner struct {
	recordingRunner
	kind string
}

func (r *wireGuardApplyRunner) Run(ctx context.Context, name string, args []string, input []byte, limit int) ([]byte, error) {
	if len(args) > 4 && args[3] == "ip" {
		return []byte(`[{"ifname":"wg0","linkinfo":{"info_kind":"` + r.kind + `"}}]`), nil
	}
	return r.recordingRunner.Run(ctx, name, args, input, limit)
}
func TestWireGuardTransactionApplyAndRollback(t *testing.T) {
	for _, fail := range []bool{false, true} {
		runner := &wireGuardApplyRunner{recordingRunner: recordingRunner{failFirstSync: fail}, kind: "wireguard"}
		runtime := &DockerRuntime{runner: runner}
		instance := Instance{ID: "fixture-instance", Adapter: "wireguard", ProtocolVersion: "wireguard", ContainerID: strings.Repeat("a", 64), InterfaceName: "wg0", ConfigPath: "/opt/amnezia/wireguard/wg0.conf", Binary: "wg"}
		original := []byte("[Interface]\nAddress = 10.0.0.1/24\n")
		err := runtime.Apply(instance, "fixture-operation", original, original, fixturePublicKey, true)
		if fail && (err == nil || err.Error() != "apply failed; original configuration restored") {
			t.Fatal("rollback failed")
		}
		if !fail && err != nil {
			t.Fatal(err)
		}
		expected := 1
		if fail {
			expected = 2
		}
		if runner.syncCalls != expected {
			t.Fatal("wrong apply/rollback count")
		}
		for _, call := range runner.calls {
			for _, arg := range call {
				if arg == "restart" || arg == "up" || arg == "down" {
					t.Fatal("transaction restarts runtime")
				}
			}
		}
	}
}

func TestLegacyFieldsIdentifyProtocolWithEitherToolName(t *testing.T) {
	for _, binary := range []string{"wg", "awg"} {
		doc, _ := configdoc.Parse([]byte("[Interface]\nJc = 4\nJmin = 12\nJmax = 30\nS1 = 20\nS2 = 24\nH1 = 100\nH2 = 200\nH3 = 300\nH4 = 400\n"))
		profile := profileForConfig(binary, doc, false)
		if profile.adapter != "amneziawg-legacy" || !profile.supported {
			t.Fatal("Legacy identity incorrectly depends on tool name")
		}
		profile = profileForConfig(binary, doc, true)
		if profile.supported {
			t.Fatal("conflicting standard kernel engine accepted")
		}
	}
}
