package configdoc

import (
	"errors"
	"fmt"
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
