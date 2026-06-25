use std::{
    fs,
    net::{IpAddr, ToSocketAddrs},
    path::{Path, PathBuf},
};

use url::Url;

pub fn canonicalize_existing_file(path: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| format!("Cannot read file: {error}"))?;
    if !canonical.is_file() {
        return Err("Selected path is not a file".to_string());
    }
    Ok(canonical)
}

pub fn path_inside_root(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

pub fn validate_remote_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|error| format!("Invalid URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https URLs are supported".to_string());
    }

    let host = url.host_str().ok_or_else(|| "URL must include a host".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Err("Localhost URLs are not allowed".to_string());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        reject_private_ip(ip)?;
        return Ok(url);
    }

    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Cannot resolve URL host: {error}"))?;

    for address in addresses {
        reject_private_ip(address.ip())?;
    }

    Ok(url)
}

fn reject_private_ip(ip: IpAddr) -> Result<(), String> {
    match ip {
        IpAddr::V4(ip) => {
            if ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.octets()[0] == 0
            {
                return Err("Private or local network URLs are not allowed".to_string());
            }
        }
        IpAddr::V6(ip) => {
            if ip.is_loopback() || ip.is_unspecified() || ip.is_unique_local() || ip.is_unicast_link_local() {
                return Err("Private or local network URLs are not allowed".to_string());
            }
        }
    }
    Ok(())
}
