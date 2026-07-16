package configdoc

import (
	"bytes"
	"testing"
)

func TestRoundTripPreservesUnknownFieldsAndComments(t *testing.T) {
	fixture := []byte("# preserved\n[Interface]\nPrivateKey = fixture-private\nUnknownField = keep-me\n\n[Peer]\n# device\nPublicKey = fixture-public\nAllowedIPs = 10.0.0.2/32\n")
	document, err := Parse(fixture)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !bytes.Equal(document.Bytes(), fixture) {
		t.Fatalf("round-trip changed input\nwant: %q\n got: %q", fixture, document.Bytes())
	}
}

func TestRemoveAndRestorePeer(t *testing.T) {
	fixture := []byte("[Interface]\nAddress = 10.0.0.1/24\n\n[Peer]\n# note\nPublicKey = fixture-public\nAllowedIPs = 10.0.0.2/32\n")
	document, _ := Parse(fixture)
	stored, err := document.RemovePeer("fixture-public")
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if bytes.Contains(document.Bytes(), []byte("fixture-public")) {
		t.Fatal("peer was not removed")
	}
	if err := document.RestorePeer(*stored); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !bytes.Equal(document.Bytes(), fixture) {
		t.Fatalf("restore was not byte-equivalent\nwant: %q\n got: %q", fixture, document.Bytes())
	}
}
