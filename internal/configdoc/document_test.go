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

func TestInterfaceValuesReadsOnlyExplicitCommentedClientFields(t *testing.T) {
	fixture := []byte("[Interface]\nJc = 4\n# I1 = <r 2><b 0x0102>\n# PrivateKey = must-not-leak\n; I2 = <b 0x0304>\n")
	document, err := Parse(fixture)
	if err != nil {
		t.Fatal(err)
	}
	values := document.InterfaceValuesWithCommented(
		map[string]struct{}{"jc": {}},
		map[string]struct{}{"i1": {}, "i2": {}},
	)
	if values["Jc"] != "4" || values["I1"] != "<r 2><b 0x0102>" || values["I2"] != "<b 0x0304>" {
		t.Fatalf("unexpected client fields: %#v", values)
	}
	if _, leaked := values["PrivateKey"]; leaked {
		t.Fatal("commented private key was included")
	}
}

func TestAllocateIPv4AddressCIDRSkipsServerAndOccupiedRanges(t *testing.T) {
	document, err := Parse([]byte(`[Interface]
Address = 10.8.0.1/24, fd00::1/64

[Peer]
PublicKey = fixture-one
AllowedIPs = 10.8.0.2/32

[Peer]
PublicKey = fixture-range
AllowedIPs = 10.8.0.3/31, fd00::2/128
`))
	if err != nil {
		t.Fatal(err)
	}
	address, err := document.AllocateIPv4AddressCIDR()
	if err != nil {
		t.Fatal(err)
	}
	if address != "10.8.0.4/32" {
		t.Fatalf("expected first free address, got %q", address)
	}
}

func TestAllocateIPv4AddressCIDRFailsClosed(t *testing.T) {
	tests := map[string]string{
		"missing":   "[Interface]\nListenPort = 1234\n",
		"ambiguous": "[Interface]\nAddress = 10.0.0.1/24, 10.1.0.1/24\n",
		"malformed": "[Interface]\nAddress = not-a-prefix\n",
		"exhausted": "[Interface]\nAddress = 10.0.0.1/30\n\n[Peer]\nPublicKey = fixture\nAllowedIPs = 10.0.0.2/32\n",
	}
	for name, fixture := range tests {
		t.Run(name, func(t *testing.T) {
			document, err := Parse([]byte(fixture))
			if err != nil {
				t.Fatal(err)
			}
			if address, err := document.AllocateIPv4AddressCIDR(); err == nil {
				t.Fatalf("expected allocation failure, got %q", address)
			}
		})
	}
}

func TestValidateAvailableIPv4AddressCIDRRejectsConflictAndInvalidHost(t *testing.T) {
	document, err := Parse([]byte(`[Interface]
Address = 10.8.0.1/24

[Peer]
PublicKey = fixture
AllowedIPs = 10.8.0.4/30
`))
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{"10.8.0.1/32", "10.8.0.5/32", "10.9.0.2/32", "10.8.0.2/31"} {
		if err := document.ValidateAvailableIPv4AddressCIDR(address); err == nil {
			t.Fatalf("expected %s to be rejected", address)
		}
	}
	if err := document.ValidateAvailableIPv4AddressCIDR("10.8.0.2/32"); err != nil {
		t.Fatalf("expected free host to be accepted: %v", err)
	}
}
