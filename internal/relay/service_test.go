package relay

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/mednov-ai/awg-control/internal/protocol"
)

type fakeRuntime struct {
	active        bool
	invalid       bool
	failApply     bool
	failRollback  bool
	validateCalls int
	transitions   int
	enabled       bool
}

func (f *fakeRuntime) Validate(string) error {
	f.validateCalls++
	if f.invalid {
		return errors.New("invalid")
	}
	return nil
}
func (f *fakeRuntime) Active() bool                  { return f.active }
func (f *fakeRuntime) Verify([]Route) error          { return nil }
func (f *fakeRuntime) Enabled() bool                 { return f.enabled }
func (f *fakeRuntime) SetEnabled(enabled bool) error { f.enabled = enabled; return nil }
func (f *fakeRuntime) Reload() error                 { return nil }
func (f *fakeRuntime) Transition(installed, previouslyActive bool) error {
	f.transitions++
	if installed && f.failApply {
		f.failApply = false
		return errors.New("apply failed")
	}
	if !installed && f.failRollback {
		return errors.New("rollback failed")
	}
	f.active = installed
	f.enabled = installed
	return nil
}
func req(action, op string, params any) protocol.Request {
	data, _ := json.Marshal(params)
	return protocol.Request{ProtocolVersion: "1.1", RequestID: "req", OperationID: op, Action: protocol.Action(action), Parameters: data}
}
func getStatus(t *testing.T, s *Service) Status {
	t.Helper()
	r := s.Handle(req("status", "read", struct{}{}))
	if !r.OK {
		t.Fatalf("status: %s", r.Error.Code)
	}
	return r.Result.(Status)
}
func install(t *testing.T, s *Service) Status {
	t.Helper()
	r := s.Handle(req("install", "install", Params{ExpectedFingerprint: getStatus(t, s).SourceFingerprint}))
	if !r.OK {
		t.Fatalf("install: %s", r.Error.Code)
	}
	return r.Result.(Status)
}

var testRoute = Route{ID: "019a0000-0000-7000-8000-000000000001", ListenPort: 47300, UpstreamIPv4: "203.0.113.10", UpstreamPort: 47300, Enabled: true}

func TestRelayLifecycleAndIdempotency(t *testing.T) {
	runtime := &fakeRuntime{}
	s := NewService(t.TempDir(), runtime)
	state := install(t, s)
	params := Params{ExpectedFingerprint: state.SourceFingerprint, Route: &testRoute}
	r := s.Handle(req("apply", "route", params))
	if !r.OK {
		t.Fatal(r.Error.Code)
	}
	state = r.Result.(Status)
	repeats := runtime.transitions
	r = s.Handle(req("apply", "route", params))
	if !r.OK || runtime.transitions != repeats {
		t.Fatal("repeat mutated runtime")
	}
	conflict := params
	conflict.ExpectedFingerprint = state.SourceFingerprint
	if s.Handle(req("apply", "route", conflict)).Error.Code != "IDEMPOTENCY_CONFLICT" {
		t.Fatal("expected conflict")
	}
	r = s.Handle(req("disable", "disable", Params{ExpectedFingerprint: state.SourceFingerprint, RouteID: testRoute.ID}))
	if !r.OK || r.Result.(Status).Routes[0].Enabled {
		t.Fatal("disable failed")
	}
	state = r.Result.(Status)
	r = s.Handle(req("remove", "remove", Params{ExpectedFingerprint: state.SourceFingerprint, RouteID: testRoute.ID}))
	if !r.OK || len(r.Result.(Status).Routes) != 0 {
		t.Fatal("remove failed")
	}
	state = r.Result.(Status)
	r = s.Handle(req("uninstall", "uninstall", Params{ExpectedFingerprint: state.SourceFingerprint}))
	if !r.OK || r.Result.(Status).Installed || runtime.active {
		t.Fatal("uninstall failed")
	}
	if _, err := os.Stat(s.path(UnitPath)); !os.IsNotExist(err) {
		t.Fatal("unit remains")
	}
}
func TestValidationConflictAndRollback(t *testing.T) {
	for _, mode := range []string{"validation", "apply", "fingerprint"} {
		t.Run(mode, func(t *testing.T) {
			runtime := &fakeRuntime{}
			s := NewService(t.TempDir(), runtime)
			before := install(t, s)
			finger := before.SourceFingerprint
			switch mode {
			case "validation":
				runtime.invalid = true
			case "apply":
				runtime.failApply = true
			case "fingerprint":
				finger = strings.Repeat("f", 64)
			}
			r := s.Handle(req("apply", "test", Params{ExpectedFingerprint: finger, Route: &testRoute}))
			if r.OK {
				t.Fatal("expected failure")
			}
			after := getStatus(t, s)
			if after.SourceFingerprint != before.SourceFingerprint || !after.Active || len(after.Routes) != 0 {
				t.Fatal("previous state was not preserved")
			}
		})
	}
}
func TestRelayProtocolSecurityAndVersions(t *testing.T) {
	for _, v := range []string{"1.0", "1.1"} {
		r, err := DecodeRequest(strings.NewReader(`{"protocolVersion":"` + v + `","requestId":"r","operationId":"o","action":"status","parameters":{}}`))
		if err != nil || r.Action != "status" {
			t.Fatal("version compatibility")
		}
	}
	for _, input := range []string{
		`{"protocolVersion":"1.1","requestId":"r","operationId":"o","action":"create","parameters":{}}`,
		`{"protocolVersion":"1.2","requestId":"r","operationId":"o","action":"status","parameters":{}}`,
		`{"protocolVersion":"1.1","requestId":"r","operationId":"o","action":"status","parameters":{},"command":"sh"}`,
		`{"protocolVersion":"1.1","requestId":"r","operationId":"../../path","action":"status","parameters":{}}`,
	} {
		if _, err := DecodeRequest(strings.NewReader(input)); err == nil {
			t.Fatal("unsafe request accepted")
		}
	}
	runtime := &fakeRuntime{}
	s := NewService(t.TempDir(), runtime)
	r := s.Handle(req("install", "unsafe", map[string]any{"expectedFingerprint": getStatus(t, s).SourceFingerprint, "path": "/etc/shadow"}))
	if r.OK || runtime.transitions != 0 {
		t.Fatal("unknown parameters accepted")
	}
	invalid := testRoute
	invalid.UpstreamIPv4 = "203.0.113.10;sh"
	if _, err := Render([]Route{invalid}); err == nil {
		t.Fatal("injection accepted")
	}
	if _, err := Render([]Route{testRoute, testRoute}); err == nil {
		t.Fatal("duplicate port accepted")
	}
}
func TestInterruptedMutationRecoveredOnlyOnExplicitMutation(t *testing.T) {
	runtime := &fakeRuntime{}
	s := NewService(t.TempDir(), runtime)
	install(t, s)
	before, err := s.capture()
	if err != nil {
		t.Fatal(err)
	}
	path := s.path(StatePath + "/journal/interrupted.json")
	if err = saveJSON(path, journal{Hash: "test", Status: "pending", Before: before}); err != nil {
		t.Fatal(err)
	}
	if err = writeFile(s.path(ConfigPath), []byte("interrupted"), 0o644); err != nil {
		t.Fatal(err)
	}
	calls := runtime.transitions
	invalid := s.Handle(req("update", "invalid", map[string]any{"expectedFingerprint": fingerprint(before), "command": "sh"}))
	if invalid.OK || runtime.transitions != calls {
		t.Fatal("invalid request must not trigger recovery")
	}
	r := s.Handle(req("status", "check", struct{}{}))
	if r.OK || r.Error.Code != "RELAY_RECOVERY_REQUIRED" || calls != runtime.transitions {
		t.Fatal("status must not mutate")
	}
	r = s.Handle(req("update", "recover", Params{ExpectedFingerprint: fingerprint(before)}))
	if !r.OK {
		t.Fatal(r.Error.Code)
	}
	if getStatus(t, s).SourceFingerprint != fingerprint(before) {
		t.Fatal("recovery did not restore original state")
	}
}
func TestTemplatePreservesDatagramsAndIsolation(t *testing.T) {
	data, err := Render([]Route{testRoute})
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, expected := range []string{"udp reuseport", "proxy_timeout 120s", "proxy_requests 0", "proxy_protocol off", "access_log off"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("missing %s", expected)
		}
	}
	if strings.Contains(text, "proxy_responses") {
		t.Fatal("response datagrams must not be limited")
	}
	if strings.Contains(serviceUnit, "docker") || strings.Contains(serviceUnit, "awg-control-enforce") {
		t.Fatal("relay crossed VPN boundary")
	}
}

func TestRollbackPreservesStoppedEnabledService(t *testing.T) {
	runtime := &fakeRuntime{}
	s := NewService(t.TempDir(), runtime)
	installed := install(t, s)
	runtime.active = false
	runtime.enabled = true
	runtime.failApply = true
	response := s.Handle(req("update", "stopped-update", Params{ExpectedFingerprint: installed.SourceFingerprint}))
	if response.OK || runtime.active || !runtime.enabled {
		t.Fatal("stopped/enabled state was not restored")
	}
}
