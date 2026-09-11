package helper

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mednov-ai/awg-control/internal/configdoc"
)

type recordingRunner struct {
	calls [][]string
}

func (r *recordingRunner) Run(_ context.Context, name string, args []string, _ []byte, _ int) ([]byte, error) {
	r.calls = append(r.calls, append([]string{name}, args...))
	return []byte(fixturePublicKey + "\n"), nil
}

func parseProfile(t *testing.T, binaryName, config string) (adapterProfile, map[string]string) {
	t.Helper()
	document, err := configdoc.Parse([]byte(config))
	if err != nil {
		t.Fatal(err)
	}
	profile := profileForConfig(binaryName, document)
	fields := document.InterfaceValuesWithCommented(profile.clientFields, commentedClientFields)
	return profile, fields
}

func TestProfileForAWG2IncludesS3S4AndCommentedIFields(t *testing.T) {
	profile, fields := parseProfile(t, "awg", `[Interface]
Jc = 4
Jmin = 12
Jmax = 30
S1 = 20
S2 = 24
S3 = 28
S4 = 32
H1 = 10-20
H2 = 30-40
H3 = 50-60
H4 = 70-80
# I1 = <r 2><b 0x0102>
`)
	if profile.adapter != "awg2" || profile.protocolVersion != "2" || !profile.supported {
		t.Fatalf("unexpected AWG2 profile: %+v", profile)
	}
	for _, key := range []string{"S3", "S4", "I1"} {
		if fields[key] == "" {
			t.Fatalf("missing client field %s: %#v", key, fields)
		}
	}
}

func TestProfileForAWG31RequiresExplicit31Markers(t *testing.T) {
	base := `[Interface]
Jc = 4
Jmin = 12
Jmax = 30
S1 = 20
S2 = 24
S3 = 28
S4 = 32
H1 = 10-20
H2 = 30-40
H3 = 50-60
H4 = 70-80
HeaderProtectionKey = DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=
ContentPaddingAddition = 10-100
`
	profile, _ := parseProfile(t, "awg", base)
	if profile.adapter != "awg3" || profile.protocolVersion != "3.0" || profile.supported {
		t.Fatalf("AWG 3.0 must be read-only: %+v", profile)
	}
	profile, fields := parseProfile(t, "awg", base+"RandomTrailers = on\nDisableCookies = on\n")
	if profile.adapter != "awg3" || profile.protocolVersion != "3.1" || !profile.supported {
		t.Fatalf("unexpected AWG 3.1 profile: %+v", profile)
	}
	if fields["HeaderProtectionKey"] == "" || fields["RandomTrailers"] != "on" || fields["DisableCookies"] != "on" {
		t.Fatalf("missing AWG 3.1 client fields: %#v", fields)
	}
}

func TestAWG31ClientConfigCarriesSharedFields(t *testing.T) {
	instance := Instance{
		Adapter: "awg3", UDPPort: 47300, ServerPublicKey: fixtureServerKey,
		ClientFields: map[string]string{
			"Jc": "4", "S1": "20", "S2": "24", "S3": "28", "S4": "32",
			"HeaderProtectionKey":    "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=",
			"ContentPaddingAddition": "10-100", "RandomTrailers": "on", "DisableCookies": "on",
		},
	}
	config, err := buildClientConfig(instance, fixturePrivateKey, "10.8.3.2/32", "vpn.example.test")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"HeaderProtectionKey = ", "ContentPaddingAddition = 10-100",
		"RandomTrailers = on", "DisableCookies = on", "MTU = 1280", "Endpoint = vpn.example.test:47300",
	} {
		if !strings.Contains(config, expected) {
			t.Fatalf("client config is missing %q", expected)
		}
	}
}

func TestQuickBinaryMatchesAdapterTooling(t *testing.T) {
	if quickBinary(Instance{Binary: "awg"}) != "awg-quick" {
		t.Fatal("AWG config validation must use awg-quick")
	}
	if quickBinary(Instance{Binary: "wg"}) != "wg-quick" {
		t.Fatal("WireGuard config validation must use wg-quick")
	}
}

func TestApplyValidatesInterfaceNamedConfiguration(t *testing.T) {
	runner := &recordingRunner{}
	runtime := &DockerRuntime{runner: runner}
	instance := Instance{
		ID: "018bcfe5-6800-7000-8000-000000000000", ContainerID: strings.Repeat("a", 64),
		InterfaceName: "awg0", ConfigPath: "/config/awg0.conf", Binary: "awg",
	}
	if err := runtime.Apply(instance, "018bcfe5-6800-7000-8000-000000000001", []byte("original"), []byte("updated"), fixturePublicKey, true); err != nil {
		t.Fatal(err)
	}
	foundStrip := false
	for _, call := range runner.calls {
		if len(call) >= 7 && call[0] == "docker" && call[1] == "exec" && call[4] == "awg-quick" && call[5] == "strip" {
			foundStrip = true
			if filepath.Base(call[6]) != "awg0.conf" {
				t.Fatalf("awg-quick must validate an interface-named config, got %q", call[6])
			}
			if filepath.Dir(call[6]) == "/tmp" {
				t.Fatalf("operation isolation requires a dedicated temporary directory, got %q", call[6])
			}
		}
	}
	if !foundStrip {
		t.Fatal("missing awg-quick strip call")
	}
}
