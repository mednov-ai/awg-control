package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
)

const MaxRequestBytes = 256 * 1024

var operationID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

type Action string

const (
	ActionDiscover    Action = "discover"
	ActionSnapshot    Action = "snapshot"
	ActionList        Action = "list"
	ActionStats       Action = "stats"
	ActionCreate      Action = "create"
	ActionRename      Action = "rename"
	ActionEnable      Action = "enable"
	ActionDisable     Action = "disable"
	ActionRevoke      Action = "revoke"
	ActionApplyPolicy Action = "apply-policy"
	ActionHealth      Action = "health"
)

var allowedActions = map[Action]struct{}{
	ActionDiscover: {}, ActionSnapshot: {}, ActionList: {}, ActionStats: {},
	ActionCreate: {}, ActionRename: {}, ActionEnable: {}, ActionDisable: {},
	ActionRevoke: {}, ActionApplyPolicy: {}, ActionHealth: {},
}

type Request struct {
	ProtocolVersion string          `json:"protocolVersion"`
	RequestID       string          `json:"requestId"`
	OperationID     string          `json:"operationId"`
	Action          Action          `json:"action"`
	Parameters      json.RawMessage `json:"parameters"`
}

type Error struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type Response struct {
	OK        bool   `json:"ok"`
	RequestID string `json:"requestId"`
	Result    any    `json:"result,omitempty"`
	Error     *Error `json:"error,omitempty"`
}

func DecodeRequest(reader io.Reader, protocolVersion string) (Request, error) {
	limited := io.LimitReader(reader, MaxRequestBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return Request{}, fmt.Errorf("read request: %w", err)
	}
	if len(data) > MaxRequestBytes {
		return Request{}, errors.New("request exceeds size limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var request Request
	if err := decoder.Decode(&request); err != nil {
		return Request{}, fmt.Errorf("decode request: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return Request{}, errors.New("request must contain exactly one JSON value")
	}
	if request.ProtocolVersion != protocolVersion {
		return Request{}, fmt.Errorf("unsupported protocol version %q", request.ProtocolVersion)
	}
	if !operationID.MatchString(request.RequestID) || !operationID.MatchString(request.OperationID) {
		return Request{}, errors.New("invalid requestId or operationId")
	}
	if _, ok := allowedActions[request.Action]; !ok {
		return Request{}, fmt.Errorf("unsupported action %q", request.Action)
	}
	if len(request.Parameters) == 0 || string(request.Parameters) == "null" {
		return Request{}, errors.New("parameters must be an object")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(request.Parameters, &object); err != nil || object == nil {
		return Request{}, errors.New("parameters must be an object")
	}
	return request, nil
}

func DecodeParameters(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid parameters: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("parameters must contain exactly one object")
	}
	return nil
}

func Failure(requestID, code, message string, retryable bool) Response {
	return Response{OK: false, RequestID: requestID, Error: &Error{Code: code, Message: message, Retryable: retryable}}
}

func Success(requestID string, result any) Response {
	return Response{OK: true, RequestID: requestID, Result: result}
}
