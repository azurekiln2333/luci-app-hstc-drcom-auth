include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-drcom-auth
PKG_VERSION:=1.6.3
PKG_RELEASE:=1

LUCI_TITLE:=LuCI panel for HSTC Dr.COM authentication
LUCI_DESCRIPTION:=Standalone LuCI panel that configures and drives the HSTC \
	Dr.COM captive-portal authentication flow (CAS ticket login).
LUCI_DEPENDS:=+curl +openssl-util
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
/etc/config/drcom_auth
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
# Keep in sync with packaging/postinst (used by scripts/package_ipk.ps1).
[ -n "$${IPKG_INSTROOT}" ] || {
	chmod 755 /etc/init.d/drcom_auth 2>/dev/null || true
	chmod 755 /usr/share/drcom-auth/*.sh 2>/dev/null || true

	# Legacy options that later versions moved into the rendered config.
	uci -q delete drcom_auth.main.term_mac
	uci -q delete drcom_auth.main.wlan_ac_ip
	uci -q delete drcom_auth.main.wlan_ac_name
	uci -q delete drcom_auth.main.login_method
	uci -q delete drcom_auth.main.authex_enable
	uci -q delete drcom_auth.main.js_version

	# opkg keeps a user-modified /etc/config/drcom_auth and drops the packaged
	# default next to it. Fill in any options missing from the user's file
	# without overwriting existing values (account, password, ...).
	ensure_default() {
		local option="$$1" value="$$2" current
		current=$$(uci -q get "drcom_auth.main.$$option")
		[ -n "$$current" ] || uci -q set "drcom_auth.main.$$option=$$value"
	}
	ensure_default enabled 0
	ensure_default wan_port eth1
	ensure_default drcom_server_ip 192.168.2.34
	ensure_default hscas_url https://hscas.hstc.edu.cn
	ensure_default hscas_public_key_url https://hscas.hstc.edu.cn/cas/jwt/publicKey
	ensure_default mac_type 2
	ensure_default check_interval 60
	ensure_default ping_host baidu.com

	uci -q commit drcom_auth
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null || true
}
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
