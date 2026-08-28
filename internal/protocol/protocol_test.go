package protocol

import (
	"strings"
	"testing"
)

func TestDecodeRequestRejectsUnknownField(t *testing.T) {
	input := `{"protocolVersion":"1.0","requestId":"req-1","operationId":"op-1","action":"health","parameters":{},"command":"sh"}`
	if _, err := DecodeRequest(strings.NewReader(input), "1.0"); err == nil {
		t.Fatal("expected unknown field to be rejected")
	}
}

func TestDecodeParametersRejectsUnknownField(t *testing.T) {
	type params struct {
		InstanceID string `json:"instanceId"`
	}
	var value params
	if err := DecodeParameters([]byte(`{"instanceId":"safe","path":"/etc/shadow"}`), &value); err == nil {
		t.Fatal("expected unknown parameter to be rejected")
	}
}

func TestDecodeRequestAcceptsHealth(t *testing.T) {
	input := `{"protocolVersion":"1.0","requestId":"req-1","operationId":"op-1","action":"health","parameters":{}}`
	request, err := DecodeRequest(strings.NewReader(input), "1.0")
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if request.Action != ActionHealth {
		t.Fatalf("unexpected action: %s", request.Action)
	}
}
