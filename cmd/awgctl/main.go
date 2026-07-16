package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"syscall"

	"github.com/mednov-ai/awg-control/internal/helper"
	"github.com/mednov-ai/awg-control/internal/protocol"
	"github.com/mednov-ai/awg-control/internal/version"
)

func main() {
	syscall.Umask(0o077)
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) < 1 || len(args) > 2 {
		return errors.New("usage: awgctl <ssh-rpc|enforce|health|uninstall-prepare restore-suspended|leave-suspended>")
	}
	if os.Geteuid() != 0 {
		return errors.New("awgctl must run as root through the restricted sudo rule")
	}
	stateDirectory := os.Getenv("AWG_CONTROL_HELPER_STATE")
	if stateDirectory == "" {
		stateDirectory = "/var/lib/awg-control-helper"
	}
	store, err := helper.NewStore(stateDirectory)
	if err != nil {
		return errors.New("helper state initialization failed")
	}
	service := helper.NewService(store, helper.NewDockerRuntime())
	switch args[0] {
	case "ssh-rpc":
		request, decodeErr := protocol.DecodeRequest(os.Stdin, version.ProtocolVersion)
		if decodeErr != nil {
			response := protocol.Failure("unknown", "INVALID_REQUEST", "request validation failed", false)
			return json.NewEncoder(os.Stdout).Encode(response)
		}
		return json.NewEncoder(os.Stdout).Encode(service.Handle(request))
	case "enforce":
		result, enforceErr := service.Enforce()
		if enforceErr != nil {
			return errors.New("local policy enforcement failed")
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "health":
		return json.NewEncoder(os.Stdout).Encode(map[string]string{
			"status": "ok", "helperVersion": version.Version, "protocolVersion": version.ProtocolVersion,
		})
	case "uninstall-prepare":
		if len(args) != 2 {
			return errors.New("uninstall-prepare requires restore-suspended or leave-suspended")
		}
		if args[1] == "restore-suspended" {
			result, restoreErr := service.RestoreAllSuspended()
			if restoreErr != nil {
				return errors.New("suspended peers could not all be restored; uninstall stopped")
			}
			return json.NewEncoder(os.Stdout).Encode(result)
		}
		if args[1] == "leave-suspended" {
			return json.NewEncoder(os.Stdout).Encode(map[string]string{"status": "acknowledged"})
		}
		return errors.New("uninstall-prepare requires restore-suspended or leave-suspended")
	default:
		return errors.New("usage: awgctl <ssh-rpc|enforce|health|uninstall-prepare>")
	}
}
