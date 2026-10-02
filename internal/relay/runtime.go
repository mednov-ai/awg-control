package relay

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type SystemRuntime struct{}

func run(command string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Never return process output, configuration or arbitrary shell text to the Panel.
	if err := exec.CommandContext(ctx, command, args...).Run(); err != nil {
		return errors.New("relay runtime command failed")
	}
	return nil
}
func validationConfig(config []byte, pid string) ([]byte, error) {
	const directive = "pid /run/awg-control-relay/nginx.pid;"
	if strings.Count(string(config), directive) != 1 {
		return nil, errors.New("invalid managed relay pid directive")
	}
	return []byte(strings.Replace(string(config), directive, "pid "+pid+";", 1)), nil
}
func (SystemRuntime) Validate(path string) error {
	// nginx -t opens its pid file. The real RuntimeDirectory exists only after
	// systemd starts the service; validation must not depend on or create it.
	config, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	workspace, err := os.MkdirTemp(filepath.Dir(path), "nginx-check-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(workspace)
	candidate, err := validationConfig(config, filepath.Join(workspace, "nginx.pid"))
	if err != nil {
		return err
	}
	candidatePath := filepath.Join(workspace, "nginx.conf")
	if err := os.WriteFile(candidatePath, candidate, 0o600); err != nil {
		return err
	}
	return run("/usr/sbin/nginx", "-t", "-c", candidatePath, "-p", workspace+"/")
}
func (SystemRuntime) Active() bool {
	return run("/usr/bin/systemctl", "is-active", "--quiet", Unit) == nil
}
func (SystemRuntime) Enabled() bool {
	return run("/usr/bin/systemctl", "is-enabled", "--quiet", Unit) == nil
}
func (SystemRuntime) Reload() error { return run("/usr/bin/systemctl", "daemon-reload") }
func (r SystemRuntime) SetEnabled(enabled bool) error {
	if enabled {
		return run("/usr/bin/systemctl", "enable", Unit)
	}
	_ = run("/usr/bin/systemctl", "disable", Unit)
	if r.Enabled() {
		return errors.New("relay remains enabled")
	}
	return nil
}

// Verify sockets owned by this service's current workers, not another nginx.
func workerIDs() []string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "--property=MainPID", "--value", Unit).Output()
	if err != nil {
		return nil
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid < 1 {
		return nil
	}
	children, err := os.ReadFile(fmt.Sprintf("/proc/%d/task/%d/children", pid, pid))
	if err != nil {
		return nil
	}
	workers := []string{}
	for _, child := range strings.Fields(string(children)) {
		if _, err := strconv.Atoi(child); err != nil {
			continue
		}
		name, err := os.ReadFile("/proc/" + child + "/cmdline")
		if err == nil && strings.Contains(string(name), "nginx: worker process") && !strings.Contains(string(name), "shutting down") {
			workers = append(workers, child)
		}
	}
	// nginx's master owns the listening descriptors too. On hardened systems
	// ss may hide worker descriptors across UIDs while still showing the master.
	if len(workers) > 0 {
		workers = append(workers, strconv.Itoa(pid))
	}
	return workers
}

func (SystemRuntime) Verify(routes []Route) error {
	workers := workerIDs()
	if len(workers) == 0 {
		return errors.New("relay worker unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	sockets, err := exec.CommandContext(ctx, "/usr/bin/ss", "-H", "-l", "-u", "-n", "-p").Output()
	if err != nil {
		return errors.New("relay sockets unavailable")
	}
	for _, r := range routes {
		if !r.Enabled {
			continue
		}
		found := false
		for _, line := range strings.Split(string(sockets), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 5 || fields[3] != fmt.Sprintf("0.0.0.0:%d", r.ListenPort) {
				continue
			}
			for _, worker := range workers {
				if strings.Contains(line, "pid="+worker+",") {
					found = true
				}
			}
		}
		if !found {
			return errors.New("relay socket not ready")
		}
	}
	return nil
}
func (r SystemRuntime) Transition(installed, previouslyActive bool) error {
	if !installed {
		// A missing unit is a valid pre-installation state.
		_ = run("/usr/bin/systemctl", "disable", "--now", Unit)
		if r.Active() {
			return errors.New("relay did not stop")
		}
		return nil
	}
	if err := run("/usr/bin/systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := run("/usr/bin/systemctl", "enable", Unit); err != nil {
		return err
	}
	beforeWorkers := workerIDs()
	if previouslyActive {
		if err := run("/usr/bin/systemctl", "reload", Unit); err != nil {
			return err
		}
	} else {
		if err := run("/usr/bin/systemctl", "start", Unit); err != nil {
			return err
		}
	}
	for range 20 {
		if r.Active() {
			workers := workerIDs()
			for _, worker := range workers {
				existed := false
				for _, previous := range beforeWorkers {
					if worker == previous {
						existed = true
					}
				}
				if !previouslyActive || !existed {
					return nil
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("relay is not active")
}
