package helper

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mednov-ai/awg-control/internal/protocol"
)

const (
	fixturePrivateKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	fixturePublicKey  = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
	fixtureServerKey  = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="
)

type fakeRuntime struct {
	config    []byte
	applyFail bool
	stats     []PeerStats
}

func (f *fakeRuntime) Discover(existing []Instance) ([]Instance, error) { return existing, nil }
func (f *fakeRuntime) ReadConfig(_ Instance) ([]byte, error) {
	return append([]byte{}, f.config...), nil
}
func (f *fakeRuntime) GenerateKeyPair(_ Instance) (string, string, error) {
	return fixturePrivateKey, fixturePublicKey, nil
}
func (f *fakeRuntime) Stats(_ Instance) ([]PeerStats, error) {
	return append([]PeerStats{}, f.stats...), nil
}
func (f *fakeRuntime) Apply(_ Instance, _ string, original, updated []byte, _ string, _ bool) error {
	if f.applyFail {
		f.config = append([]byte{}, original...)
		return errors.New("fixture validation failure; rolled back")
	}
	f.config = append([]byte{}, updated...)
	return nil
}

func testStore(t *testing.T) (*Store, Instance) {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	instance := Instance{
		ID: "018bcfe5-6800-7000-8000-000000000000", DisplayName: "fixture", Adapter: "awg2",
		ContainerID: strings.Repeat("a", 64), ContainerRef: "container-fixture", InterfaceName: "awg0",
		ConfigPath: "/config/awg0.conf", ConfigRef: "config-fixture", Binary: "awg", UDPPort: 41016,
		ServerPublicKey: fixtureServerKey, SourceFingerprint: fileFingerprint([]byte("[Interface]\nAddress = 10.0.0.1/24\n")),
		Capabilities: Capabilities{Stats: true, Create: true, Suspend: true, Resume: true, Revoke: true},
	}
	if err := store.SaveInstances([]Instance{instance}); err != nil {
		t.Fatalf("save instance: %v", err)
	}
	return store, instance
}

func createRequest(t *testing.T, instance Instance, operationID string) protocol.Request {
	t.Helper()
	parameters, err := json.Marshal(createParameters{
		InstanceID: instance.ID, ExpectedFingerprint: instance.SourceFingerprint,
		ConnectionID: "018bcfe5-6800-7000-8000-000000000001", Name: "fixture-device",
		AddressCIDR: "10.0.0.2/32", EndpointHost: "vpn.example.test",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return protocol.Request{
		ProtocolVersion: "1.0", RequestID: operationID, OperationID: operationID,
		Action: protocol.ActionCreate, Parameters: parameters,
	}
}

func TestCreateDoesNotPersistClientPrivateKey(t *testing.T) {
	store, instance := testStore(t)
	runtime := &fakeRuntime{config: []byte("[Interface]\nAddress = 10.0.0.1/24\n")}
	service := NewService(store, runtime)
	response := service.Handle(createRequest(t, instance, "create-fixture"))
	if !response.OK {
		t.Fatalf("create failed: %+v", response.Error)
	}
	result := response.Result.(map[string]any)
	if !strings.Contains(result["clientConfig"].(string), fixturePrivateKey) {
		t.Fatal("one-time response did not contain private key")
	}
	stateFiles := []string{"instances.json", "journal.json", "suspended.json", "policies.json"}
	for _, name := range stateFiles {
		data, err := os.ReadFile(filepath.Join(store.root, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			t.Fatalf("read state %s: %v", name, err)
		}
		if strings.Contains(string(data), fixturePrivateKey) {
			t.Fatalf("private key leaked into %s", name)
		}
	}
	replayed := service.Handle(createRequest(t, instance, "create-fixture"))
	if replayed.OK || replayed.Error == nil || replayed.Error.Code != "CONFIG_ALREADY_ISSUED" {
		t.Fatalf("expected one-time replay rejection, got %+v", replayed)
	}
}

func TestFailedCreateLeavesOriginalConfig(t *testing.T) {
	store, instance := testStore(t)
	original := []byte("# keep\n[Interface]\nAddress = 10.0.0.1/24\n")
	instance.SourceFingerprint = fileFingerprint(original)
	if err := store.SaveInstances([]Instance{instance}); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeRuntime{config: append([]byte{}, original...), applyFail: true}
	service := NewService(store, runtime)
	response := service.Handle(createRequest(t, instance, "rollback-fixture"))
	if response.OK || response.Error == nil || response.Error.Code != "MUTATION_ROLLED_BACK" {
		t.Fatalf("expected rollback error, got %+v", response)
	}
	if string(runtime.config) != string(original) {
		t.Fatalf("configuration changed after failed mutation\nwant: %q\n got: %q", original, runtime.config)
	}
}

func TestOperationIDRejectsDifferentParameters(t *testing.T) {
	store, instance := testStore(t)
	runtime := &fakeRuntime{config: []byte("[Interface]\nAddress = 10.0.0.1/24\n")}
	service := NewService(store, runtime)
	first := createRequest(t, instance, "same-operation")
	if response := service.Handle(first); !response.OK {
		t.Fatalf("first request failed: %+v", response.Error)
	}
	second := createRequest(t, instance, "same-operation")
	var parameters createParameters
	if err := json.Unmarshal(second.Parameters, &parameters); err != nil {
		t.Fatal(err)
	}
	parameters.Name = "different-device"
	second.Parameters, _ = json.Marshal(parameters)
	response := service.Handle(second)
	if response.OK || response.Error == nil || response.Error.Code != "IDEMPOTENCY_CONFLICT" {
		t.Fatalf("expected idempotency conflict, got %+v", response)
	}
}

func TestEnforcementBaselinesCountersBeforeAddingDeltas(t *testing.T) {
	store, instance := testStore(t)
	limit := uint64(1_000)
	if err := store.SavePolicies([]Policy{{
		ConnectionID: "018bcfe5-6800-7000-8000-000000000001", InstanceID: instance.ID,
		PublicKey: fixturePublicKey, LimitBytes: &limit, UsedBytes: 900, UsageEpoch: "lifetime", Status: "active",
	}}); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeRuntime{stats: []PeerStats{{PublicKey: fixturePublicKey, RXBytes: 500, TXBytes: 500}}}
	service := NewService(store, runtime)
	result, err := service.Enforce()
	if err != nil {
		t.Fatal(err)
	}
	if result.Suspended != 0 {
		t.Fatalf("first counter sample was double-counted: %+v", result)
	}
	policies, err := store.Policies()
	if err != nil {
		t.Fatal(err)
	}
	if len(policies) != 1 || policies[0].UsedBytes != 900 || !policies[0].CountersInitialized {
		t.Fatalf("unexpected baseline policy: %+v", policies)
	}
}

func TestPolicyProjectionPreservesNodeEnforcedStatus(t *testing.T) {
	store, instance := testStore(t)
	connectionID := "018bcfe5-6800-7000-8000-000000000001"
	if err := store.SavePolicies([]Policy{{
		ConnectionID: connectionID, InstanceID: instance.ID, PublicKey: fixturePublicKey,
		UsageEpoch: "lifetime", Status: "expired",
	}}); err != nil {
		t.Fatal(err)
	}
	parameters, err := json.Marshal(map[string]any{"policies": []map[string]any{{
		"connectionId": connectionID, "instanceId": instance.ID, "publicKey": fixturePublicKey,
		"expiresAt": nil, "limitBytes": nil, "usedBytes": 0, "status": "active", "usageEpoch": "lifetime",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store, &fakeRuntime{})
	response := service.Handle(protocol.Request{
		ProtocolVersion: "1.0", RequestID: "policy-sync", OperationID: "policy-sync",
		Action: protocol.ActionApplyPolicy, Parameters: parameters,
	})
	if !response.OK {
		t.Fatalf("policy sync failed: %+v", response.Error)
	}
	policies, err := store.Policies()
	if err != nil {
		t.Fatal(err)
	}
	if len(policies) != 1 || policies[0].Status != "expired" {
		t.Fatalf("node-enforced status was overwritten: %+v", policies)
	}
}

func TestOfflineExpiryCanBeOverriddenExplicitly(t *testing.T) {
	store, instance := testStore(t)
	connectionID := "018bcfe5-6800-7000-8000-000000000001"
	config := []byte("[Interface]\nAddress = 10.0.0.1/24\n\n[Peer]\nPublicKey = " + fixturePublicKey + "\nAllowedIPs = 10.0.0.2/32\n")
	instance.SourceFingerprint = fileFingerprint(config)
	if err := store.SaveInstances([]Instance{instance}); err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-time.Minute)
	if err := store.SavePolicies([]Policy{{
		ConnectionID: connectionID, InstanceID: instance.ID, PublicKey: fixturePublicKey,
		ExpiresAt: &past, UsageEpoch: "lifetime", Status: "active",
	}}); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeRuntime{config: append([]byte{}, config...)}
	service := NewService(store, runtime)
	result, err := service.Enforce()
	if err != nil || result.Suspended != 1 {
		t.Fatalf("offline expiry was not enforced: result=%+v err=%v", result, err)
	}
	if strings.Contains(string(runtime.config), fixturePublicKey) {
		t.Fatal("expired peer remained active")
	}
	updatedInstance, err := store.Instance(instance.ID)
	if err != nil {
		t.Fatal(err)
	}
	parameters, _ := json.Marshal(mutationParameters{
		InstanceID: updatedInstance.ID, ExpectedFingerprint: updatedInstance.SourceFingerprint,
		ConnectionID: connectionID, PublicKey: fixturePublicKey, Override: true,
	})
	response := service.Handle(protocol.Request{
		ProtocolVersion: "1.0", RequestID: "expiry-override", OperationID: "expiry-override",
		Action: protocol.ActionEnable, Parameters: parameters,
	})
	if !response.OK {
		t.Fatalf("expiry override failed: %+v", response.Error)
	}
	if !strings.Contains(string(runtime.config), fixturePublicKey) {
		t.Fatal("overridden peer was not restored")
	}
	policies, err := store.Policies()
	if err != nil {
		t.Fatal(err)
	}
	if len(policies) != 1 || policies[0].Status != "active" || policies[0].ExpiresAt != nil {
		t.Fatalf("expiry override did not reset policy: %+v", policies)
	}
}
