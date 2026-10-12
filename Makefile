include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-drcom-auth
PKG_VERSION:=1.0.0
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
[ -n "$${IPKG_INSTROOT}" ] || {
	chmod 755 /etc/init.d/drcom_auth 2>/dev/null || true
	chmod 755 /usr/share/drcom-auth/*.sh 2>/dev/null || true
	uci -q delete drcom_auth.main.term_mac
	uci -q delete drcom_auth.main.wlan_ac_ip
	uci -q delete drcom_auth.main.wlan_ac_name
	uci -q delete drcom_auth.main.login_method
	uci -q delete drcom_auth.main.authex_enable
	uci -q delete drcom_auth.main.js_version
	uci -q commit drcom_auth
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null || true
}
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
