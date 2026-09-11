package configdoc

import (
	"errors"
	"fmt"
	"net/netip"
	"sort"
	"strings"
)

type Section struct {
	Header string
	Lines  []string
}

type Document struct {
	Preamble []string
	Sections []Section
	Newline  string
	FinalEOL bool
}

type Peer struct {
	PublicKey   string
	AddressCIDR string
	Name        string
}

type ipv4Range struct {
	first uint64
	last  uint64
}

func Parse(data []byte) (*Document, error) {
	text := string(data)
	newline := "\n"
	if strings.Contains(text, "\r\n") {
		newline = "\r\n"
	}
	finalEOL := strings.HasSuffix(text, "\n")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	if len(data) == 0 {
		lines = nil
	}
	document := &Document{Newline: newline, FinalEOL: finalEOL}
	var current *Section
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			name := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "["), "]"))
			if name == "" {
				return nil, fmt.Errorf("empty section at line %d", index+1)
			}
			document.Sections = append(document.Sections, Section{Header: line})
			current = &document.Sections[len(document.Sections)-1]
			continue
		}
		if current == nil {
			document.Preamble = append(document.Preamble, line)
		} else {
			current.Lines = append(current.Lines, line)
		}
	}
	return document, nil
}

func (d *Document) Bytes() []byte {
	lines := append([]string{}, d.Preamble...)
	for _, section := range d.Sections {
		lines = append(lines, section.Header)
		lines = append(lines, section.Lines...)
	}
	result := strings.Join(lines, d.Newline)
	if d.FinalEOL || len(lines) > 0 {
		result += d.Newline
	}
	return []byte(result)
}

func sectionName(header string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(header), "["), "]")))
}

func property(line string) (string, string, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, ";") {
		return "", "", false
	}
	parts := strings.SplitN(trimmed, "=", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), true
}

func commentedProperty(line string) (string, string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(trimmed, ";") {
		return "", "", false
	}
	trimmed = strings.TrimSpace(trimmed[1:])
	parts := strings.SplitN(trimmed, "=", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	key := strings.TrimSpace(parts[0])
	value := strings.TrimSpace(parts[1])
	if key == "" || value == "" {
		return "", "", false
	}
	return key, value, true
}

func (d *Document) Peer(publicKey string) (int, *Section) {
	for index := range d.Sections {
		section := &d.Sections[index]
		if sectionName(section.Header) != "peer" {
			continue
		}
		for _, line := range section.Lines {
			key, value, ok := property(line)
			if ok && strings.EqualFold(key, "PublicKey") && value == publicKey {
				return index, section
			}
		}
	}
	return -1, nil
}

func (d *Document) AddPeer(publicKey, addressCIDR, name string) error {
	if _, peer := d.Peer(publicKey); peer != nil {
		return errors.New("peer already exists")
	}
	if strings.ContainsAny(publicKey+addressCIDR+name, "\r\n") {
		return errors.New("peer values must not contain newlines")
	}
	if len(d.Sections) > 0 {
		last := &d.Sections[len(d.Sections)-1]
		if len(last.Lines) == 0 || strings.TrimSpace(last.Lines[len(last.Lines)-1]) != "" {
			last.Lines = append(last.Lines, "")
		}
	}
	lines := []string{}
	if name != "" {
		lines = append(lines, "# AWG Control: "+name)
	}
	lines = append(lines, "PublicKey = "+publicKey, "AllowedIPs = "+addressCIDR)
	d.Sections = append(d.Sections, Section{Header: "[Peer]", Lines: lines})
	return nil
}

func (d *Document) RemovePeer(publicKey string) (*Section, error) {
	index, section := d.Peer(publicKey)
	if section == nil {
		return nil, errors.New("peer not found")
	}
	copySection := &Section{Header: section.Header, Lines: append([]string{}, section.Lines...)}
	d.Sections = append(d.Sections[:index], d.Sections[index+1:]...)
	return copySection, nil
}

func (d *Document) RestorePeer(section Section) error {
	for _, line := range section.Lines {
		key, value, ok := property(line)
		if ok && strings.EqualFold(key, "PublicKey") {
			if _, existing := d.Peer(value); existing != nil {
				return errors.New("peer already exists")
			}
			d.Sections = append(d.Sections, Section{Header: section.Header, Lines: append([]string{}, section.Lines...)})
			return nil
		}
	}
	return errors.New("stored peer has no public key")
}

func (d *Document) InterfaceValues(allowlist map[string]struct{}) map[string]string {
	values := make(map[string]string)
	for _, section := range d.Sections {
		if sectionName(section.Header) != "interface" {
			continue
		}
		for _, line := range section.Lines {
			key, value, ok := property(line)
			if !ok {
				continue
			}
			if _, allowed := allowlist[strings.ToLower(key)]; allowed {
				values[key] = value
			}
		}
	}
	return values
}

// InterfaceValuesWithCommented reads active allowlisted properties and selected
// commented properties. Amnezia keeps I1-I5 commented in the server config but
// requires their values in client configs, so callers must explicitly allow only
// those comment keys rather than treating arbitrary comments as configuration.
func (d *Document) InterfaceValuesWithCommented(
	allowlist map[string]struct{},
	commentedAllowlist map[string]struct{},
) map[string]string {
	values := d.InterfaceValues(allowlist)
	active := make(map[string]struct{}, len(values))
	for key := range values {
		active[strings.ToLower(key)] = struct{}{}
	}
	for _, section := range d.Sections {
		if sectionName(section.Header) != "interface" {
			continue
		}
		for _, line := range section.Lines {
			key, value, ok := commentedProperty(line)
			lower := strings.ToLower(key)
			if !ok {
				continue
			}
			if _, allowed := commentedAllowlist[lower]; !allowed {
				continue
			}
			if _, exists := active[lower]; !exists {
				values[key] = value
			}
		}
	}
	return values
}

func (d *Document) Peers() []Peer {
	peers := make([]Peer, 0)
	for _, section := range d.Sections {
		if sectionName(section.Header) != "peer" {
			continue
		}
		peer := Peer{}
		for _, line := range section.Lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "# AWG Control:") {
				peer.Name = strings.TrimSpace(strings.TrimPrefix(trimmed, "# AWG Control:"))
			}
			key, value, ok := property(line)
			if !ok {
				continue
			}
			switch {
			case strings.EqualFold(key, "PublicKey"):
				peer.PublicKey = value
			case strings.EqualFold(key, "AllowedIPs"):
				peer.AddressCIDR = strings.TrimSpace(strings.Split(value, ",")[0])
			}
		}
		if peer.PublicKey != "" {
			peers = append(peers, peer)
		}
	}
	return peers
}

// AllocateIPv4AddressCIDR returns the first free client host in the single IPv4
// subnet declared by the Interface Address property. All peer AllowedIPs ranges
// are treated as occupied so an allocation cannot overlap a routed subnet.
func (d *Document) AllocateIPv4AddressCIDR() (string, error) {
	server, network, occupied, err := d.ipv4AllocationState()
	if err != nil {
		return "", err
	}
	first, last := usableIPv4Range(network)
	occupied = append(occupied, ipv4Range{first: ipv4Number(server), last: ipv4Number(server)})
	sort.Slice(occupied, func(i, j int) bool {
		if occupied[i].first == occupied[j].first {
			return occupied[i].last < occupied[j].last
		}
		return occupied[i].first < occupied[j].first
	})
	candidate := first
	for _, item := range occupied {
		if item.last < candidate || item.first > last {
			continue
		}
		if item.first > candidate {
			return ipv4FromNumber(candidate).String() + "/32", nil
		}
		if item.last >= candidate {
			candidate = item.last + 1
			if candidate > last {
				break
			}
		}
	}
	if candidate <= last {
		return ipv4FromNumber(candidate).String() + "/32", nil
	}
	return "", errors.New("IPv4 address pool is exhausted")
}

// ValidateAvailableIPv4AddressCIDR supports a rolling Helper-first deployment
// with the previous Panel. New Panel versions never expose this override.
func (d *Document) ValidateAvailableIPv4AddressCIDR(value string) error {
	address, err := netip.ParsePrefix(strings.TrimSpace(value))
	if err != nil || !address.Addr().Is4() || address.Bits() != 32 {
		return errors.New("client address must be an IPv4 /32")
	}
	server, network, occupied, err := d.ipv4AllocationState()
	if err != nil {
		return err
	}
	number := ipv4Number(address.Addr())
	first, last := usableIPv4Range(network)
	if number < first || number > last || address.Addr() == server {
		return errors.New("client address is outside the usable Instance subnet")
	}
	for _, item := range occupied {
		if number >= item.first && number <= item.last {
			return errors.New("client address overlaps an existing peer route")
		}
	}
	return nil
}

func (d *Document) ipv4AllocationState() (netip.Addr, netip.Prefix, []ipv4Range, error) {
	var serverPrefixes []netip.Prefix
	var occupied []ipv4Range
	for _, section := range d.Sections {
		name := sectionName(section.Header)
		if name != "interface" && name != "peer" {
			continue
		}
		for _, line := range section.Lines {
			key, value, ok := property(line)
			if !ok {
				continue
			}
			isInterfaceAddress := name == "interface" && strings.EqualFold(key, "Address")
			isPeerRoute := name == "peer" && strings.EqualFold(key, "AllowedIPs")
			if !isInterfaceAddress && !isPeerRoute {
				continue
			}
			for _, raw := range strings.Split(value, ",") {
				prefix, err := netip.ParsePrefix(strings.TrimSpace(raw))
				if err != nil {
					return netip.Addr{}, netip.Prefix{}, nil, errors.New("malformed address allocation data")
				}
				if !prefix.Addr().Is4() {
					continue
				}
				if isInterfaceAddress {
					serverPrefixes = append(serverPrefixes, prefix)
					continue
				}
				first, last := entireIPv4Range(prefix.Masked())
				occupied = append(occupied, ipv4Range{first: first, last: last})
			}
		}
	}
	if len(serverPrefixes) != 1 {
		return netip.Addr{}, netip.Prefix{}, nil, errors.New("Instance must declare exactly one IPv4 subnet")
	}
	server := serverPrefixes[0].Addr()
	network := serverPrefixes[0].Masked()
	if network.Bits() < 1 || network.Bits() > 30 {
		return netip.Addr{}, netip.Prefix{}, nil, errors.New("Instance IPv4 subnet has no supported client pool")
	}
	return server, network, occupied, nil
}

func usableIPv4Range(prefix netip.Prefix) (uint64, uint64) {
	first, last := entireIPv4Range(prefix)
	return first + 1, last - 1
}

func entireIPv4Range(prefix netip.Prefix) (uint64, uint64) {
	first := ipv4Number(prefix.Addr())
	size := uint64(1) << uint(32-prefix.Bits())
	return first, first + size - 1
}

func ipv4Number(address netip.Addr) uint64 {
	bytes := address.As4()
	return uint64(bytes[0])<<24 | uint64(bytes[1])<<16 | uint64(bytes[2])<<8 | uint64(bytes[3])
}

func ipv4FromNumber(value uint64) netip.Addr {
	return netip.AddrFrom4([4]byte{byte(value >> 24), byte(value >> 16), byte(value >> 8), byte(value)})
}
