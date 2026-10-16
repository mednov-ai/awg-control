package helper

import (
	"bytes"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Executed in the disposable Linux fixture; never creates an interface on macOS.
func TestWireGuardConfigStandardParser(t *testing.T) {
	if os.Getenv("AWG_WIREGUARD_FIXTURE") != "1" {
		t.Skip("requires isolated WireGuard fixture")
	}
	key := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	instance := Instance{Adapter: "wireguard", ProtocolVersion: "wireguard", UDPPort: 51820, ServerPublicKey: key, ClientFields: map[string]string{"Jc": "3", "PostUp": "false"}}
	config, err := buildClientConfig(instance, key, "10.232.0.2/32", "192.0.2.1")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "cfguard.conf")
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	stripped, err := exec.Command("wg-quick", "strip", path).Output()
	if err != nil {
		t.Fatal("standard wg-quick parser rejected generated client template")
	}
	if err := exec.Command("ip", "link", "add", "cfguard", "type", "wireguard").Run(); err != nil {
		t.Fatal("fixture interface unavailable")
	}
	defer exec.Command("ip", "link", "delete", "cfguard").Run()
	path = filepath.Join(t.TempDir(), "stripped.conf")
	if err := os.WriteFile(path, stripped, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := exec.Command("wg", "setconf", "cfguard", path).Run(); err != nil {
		t.Fatal("kernel WireGuard rejected generated client template")
	}
}
