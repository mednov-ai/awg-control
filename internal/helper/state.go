package helper

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/mednov-ai/awg-control/internal/configdoc"
)

type Capabilities struct {
	Stats          bool `json:"stats"`
	Create         bool `json:"create"`
	Suspend        bool `json:"suspend"`
	Resume         bool `json:"resume"`
	Revoke         bool `json:"revoke"`
	MetadataUpdate bool `json:"metadataUpdate"`
}

type Instance struct {
	ID                string            `json:"id"`
	DisplayName       string            `json:"displayName"`
	Adapter           string            `json:"adapter"`
	ContainerID       string            `json:"containerId"`
	ContainerRef      string            `json:"containerRef"`
	InterfaceName     string            `json:"interfaceName"`
	ConfigPath        string            `json:"configPath"`
	ConfigRef         string            `json:"configRef"`
	Binary            string            `json:"binary"`
	UDPPort           int               `json:"udpPort"`
	ServerPublicKey   string            `json:"serverPublicKey"`
	SourceFingerprint string            `json:"sourceFingerprint"`
	ClientFields      map[string]string `json:"clientFields"`
	Capabilities      Capabilities      `json:"capabilities"`
}

type SuspendedPeer struct {
	ConnectionID string            `json:"connectionId"`
	InstanceID   string            `json:"instanceId"`
	PublicKey    string            `json:"publicKey"`
	Section      configdoc.Section `json:"section"`
	StoredAt     time.Time         `json:"storedAt"`
}

type Policy struct {
	ConnectionID        string     `json:"connectionId"`
	InstanceID          string     `json:"instanceId"`
	PublicKey           string     `json:"publicKey"`
	ExpiresAt           *time.Time `json:"expiresAt,omitempty"`
	LimitBytes          *uint64    `json:"limitBytes,omitempty"`
	UsedBytes           uint64     `json:"usedBytes"`
	UsageEpoch          string     `json:"usageEpoch"`
	LastCounterRX       uint64     `json:"lastCounterRx"`
	LastCounterTX       uint64     `json:"lastCounterTx"`
	CountersInitialized bool       `json:"countersInitialized"`
	Status              string     `json:"status"`
}

type JournalRecord struct {
	OperationID string    `json:"operationId"`
	Action      string    `json:"action"`
	RequestHash string    `json:"requestHash"`
	Status      string    `json:"status"`
	ResultID    string    `json:"resultId,omitempty"`
	ErrorCode   string    `json:"errorCode,omitempty"`
	OccurredAt  time.Time `json:"occurredAt"`
}

type Store struct {
	root string
	mu   sync.Mutex
}

func NewStore(root string) (*Store, error) {
	if root == "" || !filepath.IsAbs(root) {
		return nil, errors.New("state directory must be an absolute path")
	}
	for _, directory := range []string{root, filepath.Join(root, "locks"), filepath.Join(root, "snapshots")} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return nil, fmt.Errorf("create state directory: %w", err)
		}
		if err := os.Chmod(directory, 0o700); err != nil {
			return nil, fmt.Errorf("protect state directory: %w", err)
		}
	}
	return &Store{root: root}, nil
}

func (s *Store) path(name string) string { return filepath.Join(s.root, name) }

func atomicJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".awg-control-state-")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, path)
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func (s *Store) Instances() ([]Instance, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var instances []Instance
	return instances, readJSON(s.path("instances.json"), &instances)
}

func (s *Store) SaveInstances(instances []Instance) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return atomicJSON(s.path("instances.json"), instances)
}

func (s *Store) Instance(id string) (Instance, error) {
	instances, err := s.Instances()
	if err != nil {
		return Instance{}, err
	}
	for _, instance := range instances {
		if instance.ID == id {
			return instance, nil
		}
	}
	return Instance{}, errors.New("instance not found")
}

func (s *Store) UpdateInstance(instance Instance) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var instances []Instance
	if err := readJSON(s.path("instances.json"), &instances); err != nil {
		return err
	}
	for index := range instances {
		if instances[index].ID == instance.ID {
			instances[index] = instance
			return atomicJSON(s.path("instances.json"), instances)
		}
	}
	return errors.New("instance not found")
}

func (s *Store) Suspended() (map[string]SuspendedPeer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	peers := make(map[string]SuspendedPeer)
	return peers, readJSON(s.path("suspended.json"), &peers)
}

func (s *Store) SaveSuspended(peers map[string]SuspendedPeer) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return atomicJSON(s.path("suspended.json"), peers)
}

func (s *Store) Policies() ([]Policy, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var policies []Policy
	return policies, readJSON(s.path("policies.json"), &policies)
}

func (s *Store) SavePolicies(policies []Policy) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return atomicJSON(s.path("policies.json"), policies)
}

func (s *Store) Journal() ([]JournalRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var records []JournalRecord
	return records, readJSON(s.path("journal.json"), &records)
}

func (s *Store) JournalRecord(operationID string) (*JournalRecord, error) {
	records, err := s.Journal()
	if err != nil {
		return nil, err
	}
	for index := len(records) - 1; index >= 0; index-- {
		if records[index].OperationID == operationID {
			record := records[index]
			return &record, nil
		}
	}
	return nil, nil
}

func (s *Store) AddJournal(record JournalRecord) error {
	unlock, err := s.lock("journal")
	if err != nil {
		return err
	}
	defer unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	var records []JournalRecord
	if err = readJSON(s.path("journal.json"), &records); err != nil {
		return err
	}
	records = append(records, record)
	if len(records) > 10_000 {
		records = records[len(records)-10_000:]
	}
	return atomicJSON(s.path("journal.json"), records)
}

func (s *Store) BeginJournal(record JournalRecord) (*JournalRecord, bool, error) {
	unlock, err := s.lock("journal")
	if err != nil {
		return nil, false, err
	}
	defer unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	var records []JournalRecord
	if err := readJSON(s.path("journal.json"), &records); err != nil {
		return nil, false, err
	}
	for index := len(records) - 1; index >= 0; index-- {
		if records[index].OperationID == record.OperationID {
			existing := records[index]
			return &existing, false, nil
		}
	}
	records = append(records, record)
	if err := atomicJSON(s.path("journal.json"), records); err != nil {
		return nil, false, err
	}
	return nil, true, nil
}

func (s *Store) Snapshot(instanceID, operationID string, data []byte) (string, error) {
	if !safeID(instanceID) || !safeID(operationID) {
		return "", errors.New("invalid snapshot identifier")
	}
	directory := s.path(filepath.Join("snapshots", instanceID))
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, operationID+".conf")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func (s *Store) PruneSnapshots(instanceID string, keep int) error {
	directory := s.path(filepath.Join("snapshots", instanceID))
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool {
		left, _ := entries[i].Info()
		right, _ := entries[j].Info()
		return left.ModTime().Before(right.ModTime())
	})
	for len(entries) > keep {
		if err := os.Remove(filepath.Join(directory, entries[0].Name())); err != nil {
			return err
		}
		entries = entries[1:]
	}
	return nil
}

func (s *Store) LockInstance(instanceID string) (func() error, error) {
	if !safeID(instanceID) {
		return nil, errors.New("invalid instance identifier")
	}
	return s.lock("instance-" + instanceID)
}

func (s *Store) LockPolicies() (func() error, error) {
	return s.lock("policies")
}

func (s *Store) lock(name string) (func() error, error) {
	if !safeID(name) {
		return nil, errors.New("invalid lock identifier")
	}
	file, err := os.OpenFile(s.path(filepath.Join("locks", name+".lock")), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		file.Close()
		return nil, err
	}
	return func() error {
		defer file.Close()
		return syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
	}, nil
}

func UUIDv7() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	milliseconds := uint64(time.Now().UnixMilli())
	bytes[0] = byte(milliseconds >> 40)
	bytes[1] = byte(milliseconds >> 32)
	bytes[2] = byte(milliseconds >> 24)
	bytes[3] = byte(milliseconds >> 16)
	bytes[4] = byte(milliseconds >> 8)
	bytes[5] = byte(milliseconds)
	bytes[6] = (bytes[6] & 0x0f) | 0x70
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s", hex.EncodeToString(bytes[0:4]), hex.EncodeToString(bytes[4:6]), hex.EncodeToString(bytes[6:8]), hex.EncodeToString(bytes[8:10]), hex.EncodeToString(bytes[10:16])), nil
}

func safeID(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if !(character >= 'a' && character <= 'z') && !(character >= 'A' && character <= 'Z') && !(character >= '0' && character <= '9') && character != '-' && character != '_' && character != '.' && character != ':' {
			return false
		}
	}
	return true
}

func Uint64Bytes(value uint64) []byte {
	buffer := make([]byte, 8)
	binary.BigEndian.PutUint64(buffer, value)
	return buffer
}
