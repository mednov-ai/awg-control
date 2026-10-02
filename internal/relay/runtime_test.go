package relay

import (
	"bytes"
	"strings"
	"testing"
)

func TestValidationUsesIsolatedPidWithoutChangingManagedConfig(t *testing.T) {
	config, err := Render(nil)
	if err != nil {
		t.Fatal(err)
	}
	original := bytes.Clone(config)
	candidate, err := validationConfig(config, "/private/check/nginx.pid")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(config, original) {
		t.Fatal("validation changed managed configuration")
	}
	if strings.Contains(string(candidate), "pid /run/awg-control-relay/") || !strings.Contains(string(candidate), "pid /private/check/nginx.pid;") {
		t.Fatal("validation depends on service runtime directory")
	}
	for _, invalid := range [][]byte{nil, append(bytes.Clone(config), []byte("pid /run/awg-control-relay/nginx.pid;")...)} {
		if _, err := validationConfig(invalid, "/private/check/nginx.pid"); err == nil {
			t.Fatal("unexpected managed template accepted")
		}
	}
}
