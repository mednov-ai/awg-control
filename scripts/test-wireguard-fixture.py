"""Real, isolated WireGuard UDP transport; secrets never leave this disposable fixture."""
import json
import os
import subprocess
import tempfile
import time


def run(*args, input=None):
    result = subprocess.run(args, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode:
        raise RuntimeError(f"fixture command failed: {args[0]}")
    return result.stdout.strip()


def transfer(interface):
    fields = run("wg", "show", interface, "transfer").split()
    return sum(map(int, fields[1:]))


with tempfile.TemporaryDirectory() as directory:
    os.chmod(directory, 0o700)
    server_private = run("wg", "genkey")
    client_private = run("wg", "genkey")
    server_public = run("wg", "pubkey", input=server_private + "\n")
    client_public = run("wg", "pubkey", input=client_private + "\n")
    for name, private in (("wgs", server_private), ("wgc", client_private)):
        path = os.path.join(directory, name + ".key")
        with open(path, "w") as out:
            out.write(private)
        os.chmod(path, 0o600)
        run("ip", "link", "add", name, "type", "wireguard")
        run("wg", "set", name, "private-key", path)
        run("ip", "address", "add", "10.231.0.1/32" if name == "wgs" else "10.231.0.2/32", "dev", name)
        run("ip", "link", "set", name, "up")
    kind = json.loads(run("ip", "-details", "-json", "link", "show", "dev", "wgs"))[0]["linkinfo"]["info_kind"]
    assert kind == "wireguard"
    # The client reaches an address owned by a separate network namespace: real
    # encrypted UDP, not local routing between two addresses in the same namespace.
    run("ip", "netns", "add", "wgclient")
    run("ip", "link", "set", "wgc", "netns", "wgclient")
    run("ip", "netns", "exec", "wgclient", "ip", "addr", "replace", "10.231.0.2/32", "dev", "wgc")
    run("ip", "link", "add", "vs", "type", "veth", "peer", "name", "vc")
    run("ip", "link", "set", "vc", "netns", "wgclient")
    run("ip", "addr", "add", "192.0.2.1/24", "dev", "vs")
    run("ip", "link", "set", "vs", "up")
    run("ip", "netns", "exec", "wgclient", "ip", "addr", "add", "192.0.2.2/24", "dev", "vc")
    for interface in ("vc", "lo", "wgc"):
        run("ip", "netns", "exec", "wgclient", "ip", "link", "set", interface, "up")
    run("ip", "netns", "exec", "wgclient", "ip", "route", "add", "10.231.0.1/32", "dev", "wgc")
    run("wg", "set", "wgs", "listen-port", "51820", "peer", client_public, "allowed-ips", "10.231.0.2/32")
    run("ip", "route", "add", "10.231.0.2/32", "dev", "wgs")
    run("ip", "netns", "exec", "wgclient", "wg", "set", "wgc", "peer", server_public, "allowed-ips", "10.231.0.1/32", "endpoint", "192.0.2.1:51820", "persistent-keepalive", "1")

    def ping():
        run("ip", "netns", "exec", "wgclient", "ping", "-c", "2", "-W", "3", "10.231.0.1")
        assert int(run("wg", "show", "wgs", "latest-handshakes").split()[1]) > 0
        assert transfer("wgs") > 0

    ping()
    conf = os.path.join(directory, "nginx.conf")
    with open(conf, "w") as out:
        out.write(f"load_module /usr/lib/nginx/modules/ngx_stream_module.so;\npid {directory}/nginx.pid;\nerror_log /dev/null;\nevents {{}}\nstream {{ server {{ listen 51821 udp; proxy_pass 127.0.0.1:51820; proxy_timeout 2s; proxy_responses 0; }} }}\n")
    # Unlimited replies: omit proxy_responses (default unlimited), matching managed relay.
    text = open(conf).read().replace(" proxy_responses 0;", "")
    with open(conf, "w") as out:
        out.write(text)
    run("nginx", "-t", "-c", conf)
    run("nginx", "-c", conf)
    run("ip", "netns", "exec", "wgclient", "wg", "set", "wgc", "peer", server_public, "endpoint", "192.0.2.1:51821")
    before = transfer("wgs")
    ping()
    run("ip", "netns", "exec", "wgclient", "wg", "set", "wgc", "peer", server_public, "persistent-keepalive", "0")
    time.sleep(3)
    ping()
    assert transfer("wgs") > before
    run("nginx", "-s", "stop", "-c", conf)
    run("ip", "netns", "exec", "wgclient", "wg", "set", "wgc", "peer", server_public, "endpoint", "192.0.2.1:51820")
    ping()
    print("PASS: kernel WireGuard identity, direct/relay handshake and bidirectional traffic, idle/reconnect and direct recovery; no secrets emitted")
