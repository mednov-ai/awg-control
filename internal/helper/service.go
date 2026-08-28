package helper

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mednov-ai/awg-control/internal/configdoc"
	"github.com/mednov-ai/awg-control/internal/protocol"
	"github.com/mednov-ai/awg-control/internal/version"
)

type Runtime interface {
	Discover(existing []Instance) ([]Instance, error)
	ReadConfig(instance Instance) ([]byte, error)
	GenerateKeyPair(instance Instance) (privateKey, publicKey string, err error)
	Stats(instance Instance) ([]PeerStats, error)
	Apply(instance Instance, operationID string, original, updated []byte, expectedPublicKey string, shouldExist bool) error
}

type Service struct {
	store   *Store
	runtime Runtime
	now     func() time.Time
}

func NewService(store *Store, runtime Runtime) *Service {
	return &Service{store: store, runtime: runtime, now: func() time.Time { return time.Now().UTC() }}
}

func rpcError(code, message string, retryable bool) *protocol.Error {
	return &protocol.Error{Code: code, Message: message, Retryable: retryable}
}

func (s *Service) Handle(request protocol.Request) protocol.Response {
	result, failure := s.dispatch(request)
	if failure != nil {
		return protocol.Failure(request.RequestID, failure.Code, failure.Message, failure.Retryable)
	}
	return protocol.Success(request.RequestID, result)
}

func (s *Service) dispatch(request protocol.Request) (any, *protocol.Error) {
	switch request.Action {
	case protocol.ActionHealth:
		var params struct{}
		if err := protocol.DecodeParameters(request.Parameters, &params); err != nil {
			return nil, rpcError("INVALID_REQUEST", err.Error(), false)
		}
		return map[string]any{"helperVersion": version.Version, "protocolVersion": version.ProtocolVersion}, nil
	case protocol.ActionDiscover:
		return s.discover(request)
	case protocol.ActionList:
		return s.list(request)
	case protocol.ActionStats:
		return s.stats(request)
	case protocol.ActionSnapshot:
		return s.snapshot(request)
	case protocol.ActionCreate:
		return s.create(request)
	case protocol.ActionDisable, protocol.ActionEnable, protocol.ActionRevoke:
		return s.mutateConnection(request)
	case protocol.ActionApplyPolicy:
		return s.applyPolicy(request)
	case protocol.ActionRename:
		return nil, rpcError("CAPABILITY_UNAVAILABLE", "adapter metadata update is not supported", false)
	default:
		return nil, rpcError("INVALID_REQUEST", "unsupported action", false)
	}
}

func (s *Service) discover(request protocol.Request) (any, *protocol.Error) {
	var params struct{}
	if err := protocol.DecodeParameters(request.Parameters, &params); err != nil {
		return nil, rpcError("INVALID_REQUEST", err.Error(), false)
	}
	existing, err := s.store.Instances()
	if err != nil {
		return nil, rpcError("STATE_READ_FAILED", "helper state is unavailable", true)
	}
	instances, err := s.runtime.Discover(existing)
	if err != nil {
		return nil, rpcError("DISCOVERY_FAILED", "read-only discovery failed", true)
	}
	if err := s.store.SaveInstances(instances); err != nil {
		return nil, rpcError("STATE_WRITE_FAILED", "discovery state could not be saved", true)
	}
	public := make([]map[string]any, 0, len(instances))
	for _, instance := range instances {
		public = append(public, map[string]any{
			"id": instance.ID, "displayName": instance.DisplayName, "adapter": instance.Adapter,
			"protocolVersion": instance.ProtocolVersion,
			"containerRef":    instance.ContainerRef, "interfaceName": instance.InterfaceName,
			"configRef": instance.ConfigRef, "capabilities": instance.Capabilities,
			"sourceFingerprint": instance.SourceFingerprint,
			"readOnly":          !instance.Capabilities.Create,
		})
	}
	return map[string]any{"helperVersion": version.Version, "instances": public}, nil
}

type instanceParameters struct {
	InstanceID          string `json:"instanceId"`
	ExpectedFingerprint string `json:"expectedFingerprint,omitempty"`
}

func (s *Service) instanceParameters(raw json.RawMessage, requireFingerprint bool) (Instance, instanceParameters, *protocol.Error) {
	var params instanceParameters
	if err := protocol.DecodeParameters(raw, &params); err != nil {
		return Instance{}, params, rpcError("INVALID_REQUEST", err.Error(), false)
	}
	if !safeID(params.InstanceID) {
		return Instance{}, params, rpcError("INVALID_REQUEST", "invalid instance identifier", false)
	}
	instance, err := s.store.Instance(params.InstanceID)
	if err != nil {
		return Instance{}, params, rpcError("INSTANCE_NOT_FOUND", "instance not found", false)
	}
	if requireFingerprint && params.ExpectedFingerprint == "" {
		return Instance{}, params, rpcError("INVALID_REQUEST", "expected fingerprint is required", false)
	}
	return instance, params, nil
}

func (s *Service) list(request protocol.Request) (any, *protocol.Error) {
	instance, _, failure := s.instanceParameters(request.Parameters, false)
	if failure != nil {
		return nil, failure
	}
	data, err := s.runtime.ReadConfig(instance)
	if err != nil {
		return nil, rpcError("CONFIG_READ_FAILED", "configuration could not be read", true)
	}
	document, err := configdoc.Parse(data)
	if err != nil {
		return nil, rpcError("ADAPTER_READ_ONLY", "configuration structure is unsupported", false)
	}
	peers := document.Peers()
	result := make([]map[string]string, 0, len(peers))
	for _, peer := range peers {
		result = append(result, map[string]string{
			"publicKey": peer.PublicKey, "publicKeyFingerprint": keyFingerprint(peer.PublicKey),
			"addressCidr": peer.AddressCIDR, "name": peer.Name,
		})
	}
	return map[string]any{"peers": result, "sourceFingerprint": fileFingerprint(data)}, nil
}

func (s *Service) stats(request protocol.Request) (any, *protocol.Error) {
	instance, _, failure := s.instanceParameters(request.Parameters, false)
	if failure != nil {
		return nil, failure
	}
	stats, err := s.runtime.Stats(instance)
	if err != nil {
		return nil, rpcError("STATS_FAILED", "peer statistics are unavailable", true)
	}
	return map[string]any{"peers": stats}, nil
}

func (s *Service) snapshot(request protocol.Request) (any, *protocol.Error) {
	instance, params, failure := s.instanceParameters(request.Parameters, true)
	if failure != nil {
		return nil, failure
	}
	data, err := s.runtime.ReadConfig(instance)
	if err != nil {
		return nil, rpcError("CONFIG_READ_FAILED", "configuration could not be read", true)
	}
	if fileFingerprint(data) != params.ExpectedFingerprint {
		return nil, rpcError("FINGERPRINT_CONFLICT", "configuration changed outside AWG Control", false)
	}
	if _, err := s.store.Snapshot(instance.ID, request.OperationID, data); err != nil {
		return nil, rpcError("SNAPSHOT_FAILED", "root-only snapshot could not be created", true)
	}
	_ = s.store.PruneSnapshots(instance.ID, 20)
	return map[string]any{"snapshotId": request.OperationID, "sourceFingerprint": params.ExpectedFingerprint}, nil
}

type createParameters struct {
	InstanceID          string  `json:"instanceId"`
	ExpectedFingerprint string  `json:"expectedFingerprint"`
	ConnectionID        string  `json:"connectionId"`
	Name                string  `json:"name"`
	AddressCIDR         string  `json:"addressCidr"`
	EndpointHost        string  `json:"endpointHost"`
	ExpiresAt           *string `json:"expiresAt"`
}

func (s *Service) create(request protocol.Request) (result any, failure *protocol.Error) {
	var params createParameters
	if err := protocol.DecodeParameters(request.Parameters, &params); err != nil {
		return nil, rpcError("INVALID_REQUEST", err.Error(), false)
	}
	if !safeID(params.InstanceID) || !safeID(params.ConnectionID) || !parseCIDR(params.AddressCIDR) ||
		strings.ContainsAny(params.Name, "\r\n") || len(params.Name) < 1 || len(params.Name) > 120 || !validEndpointHost(params.EndpointHost) {
		return nil, rpcError("INVALID_REQUEST", "invalid create parameters", false)
	}
	if params.ExpiresAt != nil {
		if _, err := time.Parse(time.RFC3339, *params.ExpiresAt); err != nil {
			return nil, rpcError("INVALID_REQUEST", "expiresAt must be an RFC3339 timestamp", false)
		}
	}
	if replay, failure := s.replay(request); replay != nil || failure != nil {
		return replay, failure
	}
	defer func() {
		if failure != nil {
			_ = s.record(request, "failed", params.ConnectionID, failure.Code)
		}
	}()
	instance, err := s.store.Instance(params.InstanceID)
	if err != nil {
		return nil, rpcError("INSTANCE_NOT_FOUND", "instance not found", false)
	}
	if !instance.Capabilities.Create {
		return nil, rpcError("ADAPTER_READ_ONLY", "instance is not safely writable", false)
	}
	unlock, err := s.store.LockInstance(instance.ID)
	if err != nil {
		return nil, rpcError("LOCK_FAILED", "instance lock is unavailable", true)
	}
	defer unlock()
	original, err := s.runtime.ReadConfig(instance)
	if err != nil {
		return nil, rpcError("CONFIG_READ_FAILED", "configuration could not be read", true)
	}
	if fileFingerprint(original) != params.ExpectedFingerprint {
		return nil, rpcError("FINGERPRINT_CONFLICT", "configuration changed outside AWG Control", false)
	}
	if _, err := s.store.Snapshot(instance.ID, request.OperationID, original); err != nil {
		return nil, rpcError("SNAPSHOT_FAILED", "root-only snapshot could not be created", true)
	}
	document, err := configdoc.Parse(original)
	if err != nil {
		return nil, rpcError("ADAPTER_READ_ONLY", "configuration structure is unsupported", false)
	}
	privateKey, publicKey, err := s.runtime.GenerateKeyPair(instance)
	if err != nil {
		return nil, rpcError("KEY_GENERATION_FAILED", "client key generation failed", false)
	}
	defer zeroString(&privateKey)
	if err := document.AddPeer(publicKey, params.AddressCIDR, params.Name); err != nil {
		return nil, rpcError("CONFIG_CONFLICT", err.Error(), false)
	}
	clientConfig, err := buildClientConfig(instance, privateKey, params.AddressCIDR, params.EndpointHost)
	if err != nil {
		return nil, rpcError("CLIENT_TEMPLATE_UNAVAILABLE", "client config could not be built", false)
	}
	updated := document.Bytes()
	if err := s.runtime.Apply(instance, request.OperationID, original, updated, publicKey, true); err != nil {
		zeroString(&clientConfig)
		return nil, rpcError("MUTATION_ROLLED_BACK", err.Error(), false)
	}
	instance.SourceFingerprint = fileFingerprint(updated)
	if err := s.store.UpdateInstance(instance); err != nil {
		zeroString(&clientConfig)
		return nil, rpcError("STATE_WRITE_FAILED", "mutation applied but state update failed", true)
	}
	if err := s.record(request, "succeeded", params.ConnectionID, ""); err != nil {
		zeroString(&clientConfig)
		return nil, rpcError("STATE_WRITE_FAILED", "operation result could not be journaled", true)
	}
	_ = s.store.PruneSnapshots(instance.ID, 20)
	return map[string]any{
		"publicKey": publicKey, "addressCidr": params.AddressCIDR,
		"clientConfig": clientConfig, "sourceFingerprint": instance.SourceFingerprint,
	}, nil
}

type mutationParameters struct {
	InstanceID          string `json:"instanceId"`
	ExpectedFingerprint string `json:"expectedFingerprint"`
	ConnectionID        string `json:"connectionId"`
	PublicKey           string `json:"publicKey"`
	Override            bool   `json:"override"`
}

func (s *Service) mutateConnection(request protocol.Request) (result any, failure *protocol.Error) {
	return s.mutateConnectionWithPolicyLock(request, false)
}

func (s *Service) mutateConnectionWithPolicyLock(request protocol.Request, policyLockHeld bool) (result any, failure *protocol.Error) {
	var params mutationParameters
	if err := protocol.DecodeParameters(request.Parameters, &params); err != nil {
		return nil, rpcError("INVALID_REQUEST", err.Error(), false)
	}
	if !safeID(params.InstanceID) || !safeID(params.ConnectionID) || !validWireGuardKey(params.PublicKey) || len(params.ExpectedFingerprint) != 64 {
		return nil, rpcError("INVALID_REQUEST", "invalid mutation parameters", false)
	}
	if replay, failure := s.replay(request); replay != nil || failure != nil {
		return replay, failure
	}
	defer func() {
		if failure != nil {
			_ = s.record(request, "failed", params.ConnectionID, failure.Code)
		}
	}()
	if !policyLockHeld {
		unlockPolicies, err := s.store.LockPolicies()
		if err != nil {
			return nil, rpcError("LOCK_FAILED", "policy lock is unavailable", true)
		}
		defer unlockPolicies()
	}
	instance, err := s.store.Instance(params.InstanceID)
	if err != nil {
		return nil, rpcError("INSTANCE_NOT_FOUND", "instance not found", false)
	}
	if !instance.Capabilities.Suspend {
		return nil, rpcError("ADAPTER_READ_ONLY", "instance is not safely writable", false)
	}
	result, failure = s.applyPeerMutation(request, instance, params)
	if failure != nil {
		return nil, failure
	}
	if err := s.record(request, "succeeded", params.ConnectionID, ""); err != nil {
		return nil, rpcError("STATE_WRITE_FAILED", "operation result could not be journaled", true)
	}
	return result, nil
}

func (s *Service) applyPeerMutation(request protocol.Request, instance Instance, params mutationParameters) (any, *protocol.Error) {
	unlock, err := s.store.LockInstance(instance.ID)
	if err != nil {
		return nil, rpcError("LOCK_FAILED", "instance lock is unavailable", true)
	}
	defer unlock()
	original, err := s.runtime.ReadConfig(instance)
	if err != nil {
		return nil, rpcError("CONFIG_READ_FAILED", "configuration could not be read", true)
	}
	if fileFingerprint(original) != params.ExpectedFingerprint {
		return nil, rpcError("FINGERPRINT_CONFLICT", "configuration changed outside AWG Control", false)
	}
	if _, err := s.store.Snapshot(instance.ID, request.OperationID, original); err != nil {
		return nil, rpcError("SNAPSHOT_FAILED", "root-only snapshot could not be created", true)
	}
	document, err := configdoc.Parse(original)
	if err != nil {
		return nil, rpcError("ADAPTER_READ_ONLY", "configuration structure is unsupported", false)
	}
	suspended, err := s.store.Suspended()
	if err != nil {
		return nil, rpcError("STATE_READ_FAILED", "suspended peer state is unavailable", true)
	}
	shouldExist := false
	switch request.Action {
	case protocol.ActionDisable:
		section, removeErr := document.RemovePeer(params.PublicKey)
		if removeErr != nil {
			return nil, rpcError("PEER_NOT_FOUND", "active peer not found", false)
		}
		suspended[params.ConnectionID] = SuspendedPeer{
			ConnectionID: params.ConnectionID, InstanceID: instance.ID, PublicKey: params.PublicKey,
			Section: *section, StoredAt: s.now(),
		}
		if err := s.store.SaveSuspended(suspended); err != nil {
			return nil, rpcError("STATE_WRITE_FAILED", "suspended peer state could not be saved", true)
		}
	case protocol.ActionEnable:
		stored, ok := suspended[params.ConnectionID]
		if !ok || stored.InstanceID != instance.ID || stored.PublicKey != params.PublicKey {
			return nil, rpcError("SUSPENDED_STATE_NOT_FOUND", "suspended peer state not found", false)
		}
		if err := document.RestorePeer(stored.Section); err != nil {
			return nil, rpcError("CONFIG_CONFLICT", err.Error(), false)
		}
		shouldExist = true
	case protocol.ActionRevoke:
		if _, peer := document.Peer(params.PublicKey); peer != nil {
			if _, err := document.RemovePeer(params.PublicKey); err != nil {
				return nil, rpcError("PEER_NOT_FOUND", "peer not found", false)
			}
		} else if _, ok := suspended[params.ConnectionID]; !ok {
			return nil, rpcError("PEER_NOT_FOUND", "peer not found", false)
		}
	}
	updated := document.Bytes()
	if request.Action != protocol.ActionRevoke || !equalConfig(original, updated) {
		if err := s.runtime.Apply(instance, request.OperationID, original, updated, params.PublicKey, shouldExist); err != nil {
			if request.Action == protocol.ActionDisable {
				delete(suspended, params.ConnectionID)
				_ = s.store.SaveSuspended(suspended)
			}
			return nil, rpcError("MUTATION_ROLLED_BACK", err.Error(), false)
		}
	}
	if request.Action == protocol.ActionEnable || request.Action == protocol.ActionRevoke {
		delete(suspended, params.ConnectionID)
		if err := s.store.SaveSuspended(suspended); err != nil {
			return nil, rpcError("STATE_WRITE_FAILED", "peer changed but state cleanup failed", true)
		}
	}
	policies, err := s.store.Policies()
	if err != nil {
		return nil, rpcError("STATE_READ_FAILED", "policy state is unavailable", true)
	}
	updatedPolicies := make([]Policy, 0, len(policies))
	for _, policy := range policies {
		if policy.ConnectionID != params.ConnectionID {
			updatedPolicies = append(updatedPolicies, policy)
			continue
		}
		if request.Action == protocol.ActionRevoke {
			continue
		}
		if request.Action == protocol.ActionDisable {
			policy.Status = "suspended"
		}
		if request.Action == protocol.ActionEnable {
			if params.Override {
				if policy.Status == "expired" {
					policy.ExpiresAt = nil
				}
				if policy.Status == "quota-exceeded" {
					policy.UsedBytes = 0
					policy.UsageEpoch = ""
				}
				policy.CountersInitialized = false
			}
			policy.Status = "active"
		}
		updatedPolicies = append(updatedPolicies, policy)
	}
	if err := s.store.SavePolicies(updatedPolicies); err != nil {
		return nil, rpcError("STATE_WRITE_FAILED", "peer changed but policy state update failed", true)
	}
	instance.SourceFingerprint = fileFingerprint(updated)
	if err := s.store.UpdateInstance(instance); err != nil {
		return nil, rpcError("STATE_WRITE_FAILED", "mutation applied but state update failed", true)
	}
	_ = s.store.PruneSnapshots(instance.ID, 20)
	return map[string]any{"connectionId": params.ConnectionID, "sourceFingerprint": instance.SourceFingerprint}, nil
}

type policyInput struct {
	ConnectionID string  `json:"connectionId"`
	InstanceID   string  `json:"instanceId"`
	PublicKey    string  `json:"publicKey"`
	ExpiresAt    *string `json:"expiresAt"`
	LimitBytes   *uint64 `json:"limitBytes"`
	UsedBytes    uint64  `json:"usedBytes"`
	Status       string  `json:"status"`
	UsageEpoch   string  `json:"usageEpoch"`
}

func (s *Service) applyPolicy(request protocol.Request) (result any, failure *protocol.Error) {
	var params struct {
		Policies []policyInput `json:"policies"`
	}
	if err := protocol.DecodeParameters(request.Parameters, &params); err != nil {
		return nil, rpcError("INVALID_REQUEST", err.Error(), false)
	}
	if len(params.Policies) > 10_000 {
		return nil, rpcError("INVALID_REQUEST", "too many policies", false)
	}
	replayed, replayFailure := s.replay(request)
	if replayFailure != nil {
		return nil, replayFailure
	}
	if replayed == nil {
		defer func() {
			if failure != nil {
				_ = s.record(request, "failed", "", failure.Code)
			}
		}()
	}
	unlockPolicies, err := s.store.LockPolicies()
	if err != nil {
		return nil, rpcError("LOCK_FAILED", "policy lock is unavailable", true)
	}
	defer unlockPolicies()
	existing, err := s.store.Policies()
	if err != nil {
		return nil, rpcError("STATE_READ_FAILED", "policy state is unavailable", true)
	}
	if replayed != nil {
		return policyResult(existing), nil
	}
	existingByConnection := make(map[string]Policy, len(existing))
	for _, policy := range existing {
		existingByConnection[policy.ConnectionID] = policy
	}
	policies := make([]Policy, 0, len(params.Policies))
	for _, input := range params.Policies {
		if !safeID(input.ConnectionID) || !safeID(input.InstanceID) || !validWireGuardKey(input.PublicKey) ||
			!validPolicyStatus(input.Status) || len(input.UsageEpoch) < 1 || len(input.UsageEpoch) > 160 {
			return nil, rpcError("INVALID_REQUEST", "invalid policy target", false)
		}
		var expiresAt *time.Time
		if input.ExpiresAt != nil {
			parsed, err := time.Parse(time.RFC3339, *input.ExpiresAt)
			if err != nil {
				return nil, rpcError("INVALID_REQUEST", "invalid policy expiry", false)
			}
			value := parsed.UTC()
			expiresAt = &value
		}
		previous := existingByConnection[input.ConnectionID]
		status := input.Status
		if input.Status == "active" && (previous.Status == "expired" || previous.Status == "quota-exceeded") {
			status = previous.Status
		}
		initialized := previous.CountersInitialized && previous.UsageEpoch == input.UsageEpoch
		policies = append(policies, Policy{
			ConnectionID: input.ConnectionID, InstanceID: input.InstanceID, PublicKey: input.PublicKey,
			ExpiresAt: expiresAt, LimitBytes: input.LimitBytes, UsedBytes: input.UsedBytes,
			UsageEpoch: input.UsageEpoch, LastCounterRX: previous.LastCounterRX, LastCounterTX: previous.LastCounterTX,
			CountersInitialized: initialized, Status: status,
		})
	}
	if err := s.store.SavePolicies(policies); err != nil {
		return nil, rpcError("STATE_WRITE_FAILED", "policy projection could not be saved", true)
	}
	if err := s.record(request, "succeeded", "", ""); err != nil {
		return nil, rpcError("STATE_WRITE_FAILED", "policy result could not be journaled", true)
	}
	return policyResult(policies), nil
}

func policyResult(policies []Policy) map[string]any {
	statuses := make([]map[string]string, 0, len(policies))
	for _, policy := range policies {
		statuses = append(statuses, map[string]string{"connectionId": policy.ConnectionID, "status": policy.Status})
	}
	return map[string]any{"policies": len(policies), "statuses": statuses}
}

type EnforcementResult struct {
	Checked   int `json:"checked"`
	Suspended int `json:"suspended"`
	Failed    int `json:"failed"`
}

func (s *Service) RestoreAllSuspended() (EnforcementResult, error) {
	suspended, err := s.store.Suspended()
	if err != nil {
		return EnforcementResult{}, err
	}
	result := EnforcementResult{Checked: len(suspended)}
	for _, peer := range suspended {
		instance, instanceErr := s.store.Instance(peer.InstanceID)
		if instanceErr != nil {
			result.Failed++
			continue
		}
		operationID := fmt.Sprintf("uninstall:%s:%d", peer.ConnectionID, s.now().Unix())
		params := mutationParameters{
			InstanceID: instance.ID, ExpectedFingerprint: instance.SourceFingerprint,
			ConnectionID: peer.ConnectionID, PublicKey: peer.PublicKey,
		}
		raw, _ := json.Marshal(params)
		request := protocol.Request{
			ProtocolVersion: version.ProtocolVersion, RequestID: operationID, OperationID: operationID,
			Action: protocol.ActionEnable, Parameters: raw,
		}
		if _, failure := s.mutateConnection(request); failure != nil {
			result.Failed++
			continue
		}
		result.Suspended++
	}
	if result.Failed > 0 {
		return result, errors.New("one or more suspended peers could not be restored")
	}
	return result, nil
}

func (s *Service) Enforce() (EnforcementResult, error) {
	unlockPolicies, err := s.store.LockPolicies()
	if err != nil {
		return EnforcementResult{}, err
	}
	defer unlockPolicies()
	policies, err := s.store.Policies()
	if err != nil {
		return EnforcementResult{}, err
	}
	result := EnforcementResult{Checked: len(policies)}
	statsByInstance := make(map[string]map[string]PeerStats)
	for index := range policies {
		policy := &policies[index]
		if policy.Status != "active" {
			continue
		}
		instance, instanceErr := s.store.Instance(policy.InstanceID)
		if instanceErr != nil {
			result.Failed++
			continue
		}
		stats, ok := statsByInstance[instance.ID]
		if !ok {
			values, statsErr := s.runtime.Stats(instance)
			if statsErr != nil {
				result.Failed++
				continue
			}
			stats = make(map[string]PeerStats)
			for _, value := range values {
				stats[value.PublicKey] = value
			}
			statsByInstance[instance.ID] = stats
		}
		if current, exists := stats[policy.PublicKey]; exists {
			if policy.CountersInitialized {
				deltaRX := current.RXBytes
				if current.RXBytes >= policy.LastCounterRX {
					deltaRX = current.RXBytes - policy.LastCounterRX
				}
				deltaTX := current.TXBytes
				if current.TXBytes >= policy.LastCounterTX {
					deltaTX = current.TXBytes - policy.LastCounterTX
				}
				policy.UsedBytes += deltaRX + deltaTX
			}
			policy.LastCounterRX = current.RXBytes
			policy.LastCounterTX = current.TXBytes
			policy.CountersInitialized = true
		}
		reason := ""
		if policy.ExpiresAt != nil && !s.now().Before(*policy.ExpiresAt) {
			reason = "expired"
		}
		if policy.LimitBytes != nil && policy.UsedBytes >= *policy.LimitBytes {
			reason = "quota-exceeded"
		}
		if reason == "" {
			continue
		}
		operationID := fmt.Sprintf("enforce:%s:%d", policy.ConnectionID, s.now().Unix()/60)
		params := mutationParameters{
			InstanceID: instance.ID, ExpectedFingerprint: instance.SourceFingerprint,
			ConnectionID: policy.ConnectionID, PublicKey: policy.PublicKey,
		}
		raw, _ := json.Marshal(params)
		request := protocol.Request{
			ProtocolVersion: version.ProtocolVersion, RequestID: operationID, OperationID: operationID,
			Action: protocol.ActionDisable, Parameters: raw,
		}
		if _, failure := s.mutateConnectionWithPolicyLock(request, true); failure != nil {
			result.Failed++
			continue
		}
		policy.Status = reason
		result.Suspended++
	}
	if err := s.store.SavePolicies(policies); err != nil {
		return result, err
	}
	return result, nil
}

func (s *Service) replay(request protocol.Request) (any, *protocol.Error) {
	record, created, err := s.store.BeginJournal(JournalRecord{
		OperationID: request.OperationID, Action: string(request.Action), RequestHash: requestHash(request),
		Status: "started", OccurredAt: s.now(),
	})
	if err != nil {
		return nil, rpcError("STATE_WRITE_FAILED", "operation journal is unavailable", true)
	}
	if created {
		return nil, nil
	}
	if record == nil {
		return nil, rpcError("STATE_READ_FAILED", "operation journal is invalid", true)
	}
	if record.Action != string(request.Action) {
		return nil, rpcError("IDEMPOTENCY_CONFLICT", "operationId belongs to another action", false)
	}
	if record.RequestHash != requestHash(request) {
		return nil, rpcError("IDEMPOTENCY_CONFLICT", "operationId belongs to another request", false)
	}
	if record.Status == "succeeded" {
		if request.Action == protocol.ActionCreate {
			return nil, rpcError("CONFIG_ALREADY_ISSUED", "client config cannot be returned again", false)
		}
		return map[string]any{"replayed": true, "resultId": record.ResultID}, nil
	}
	if record.Status == "started" {
		return nil, rpcError("OPERATION_IN_PROGRESS", "operation has not completed", true)
	}
	return nil, rpcError(record.ErrorCode, "previous operation failed", false)
}

func (s *Service) record(request protocol.Request, status, resultID, errorCode string) error {
	return s.store.AddJournal(JournalRecord{
		OperationID: request.OperationID, Action: string(request.Action), Status: status,
		RequestHash: requestHash(request), ResultID: resultID, ErrorCode: errorCode, OccurredAt: s.now(),
	})
}

func requestHash(request protocol.Request) string {
	sum := sha256.Sum256(append([]byte(string(request.Action)+"\n"), request.Parameters...))
	return hex.EncodeToString(sum[:])
}

func validPolicyStatus(value string) bool {
	switch value {
	case "active", "suspended", "expired", "quota-exceeded":
		return true
	default:
		return false
	}
}

func fileFingerprint(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func keyFingerprint(publicKey string) string {
	sum := sha256.Sum256([]byte(publicKey))
	return hex.EncodeToString(sum[:8])
}

func zeroString(value *string) {
	if value == nil {
		return
	}
	bytes := []byte(*value)
	for index := range bytes {
		bytes[index] = 0
	}
	*value = ""
}

func equalConfig(left, right []byte) bool {
	return string(left) == string(right)
}

var _ = errors.New
