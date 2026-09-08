"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useSessionWatch } from "@/hooks/useSessionWatch";
import {
  AppBar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import Button from "@mui/material/Button";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PetsIcon from "@mui/icons-material/Pets";
import EventIcon from "@mui/icons-material/Event";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import ReceiptIcon from "@mui/icons-material/Receipt";
import NotificationsIcon from "@mui/icons-material/Notifications";
import EmailIcon from "@mui/icons-material/Email";
import GroupIcon from "@mui/icons-material/Group";
import HistoryIcon from "@mui/icons-material/History";
import InsightsIcon from "@mui/icons-material/Insights";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import PaymentsIcon from "@mui/icons-material/Payments";
import HandshakeIcon from "@mui/icons-material/Handshake";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import LogoutIcon from "@mui/icons-material/Logout";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import SettingsIcon from "@mui/icons-material/Settings";
import { NAV_MODULES, hasPermission } from "@/lib/permissions";
import { useColorMode } from "./ThemeRegistry";
import { navTokens } from "./theme";

// Your own account page. Not in NAV_MODULES: it has no permission of its own
// and belongs to everyone, so it hangs off the name in the footer instead.
const ACCOUNT_HREF = "/reset-password";

const DRAWER_WIDTH = 240;
const COLLAPSED_WIDTH = 64;

// Logo heights, and the toolbar heights that have to accommodate them. The
// toolbars must be taller than the logo or MUI's default 56/64px min-height
// clips it, and the mobile AppBar height is shared with the spacer Toolbar in
// <main> that keeps content clear of the fixed bar, so both read from here.
const DRAWER_LOGO_HEIGHT = 64;
const APPBAR_LOGO_HEIGHT = 56;
const DRAWER_TOOLBAR_MIN_HEIGHT = DRAWER_LOGO_HEIGHT + 24;
const APPBAR_TOOLBAR_MIN_HEIGHT = APPBAR_LOGO_HEIGHT + 16;

// Radius of the inverted corner wedges above and below the active pill, which
// make it read as carved out of the pane rather than sitting on top of it.
const NOTCH = 14;

// The active item is a full-bleed pill flush to the pane's right edge. The two
// wedges are squares of pill colour with a quarter-disc masked out, so the pane
// shows through and the join between pill and pane curves inward. Centring the
// mask circle on the square's pane-side corner is what makes it concave.
function notchWedge(edge: "top" | "bottom", activeBg: string) {
  return {
    content: '""',
    position: "absolute" as const,
    right: 0,
    [edge === "top" ? "top" : "bottom"]: -NOTCH,
    width: NOTCH,
    height: NOTCH,
    backgroundColor: activeBg,
    pointerEvents: "none" as const,
    maskImage: `radial-gradient(circle ${NOTCH}px at 0 ${
      edge === "top" ? "0" : "100%"
    }, transparent ${NOTCH}px, #000 ${NOTCH}px)`,
    WebkitMaskImage: `radial-gradient(circle ${NOTCH}px at 0 ${
      edge === "top" ? "0" : "100%"
    }, transparent ${NOTCH}px, #000 ${NOTCH}px)`,
  };
}

const ICONS: Record<string, React.ReactNode> = {
  Insights: <InsightsIcon />,
  Pets: <PetsIcon />,
  Event: <EventIcon />,
  Inventory2: <Inventory2Icon />,
  Receipt: <ReceiptIcon />,
  Notifications: <NotificationsIcon />,
  MedicalServices: <MedicalServicesIcon />,
  Email: <EmailIcon />,
  Group: <GroupIcon />,
  History: <HistoryIcon />,
  Payments: <PaymentsIcon />,
  Handshake: <HandshakeIcon />,
  LocalShipping: <LocalShippingIcon />,
  ShoppingCart: <ShoppingCartIcon />,
  Settings: <SettingsIcon />,
};

interface DashboardShellProps {
  permissions: string[];
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
  children: React.ReactNode;
}

export default function DashboardShell({
  permissions,
  firstName,
  lastName,
  roleName,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  // Nothing on the server can eject a session mid-navigation, so the shell asks
  // on the client's behalf. See the hook for the three server-side approaches
  // that were tried and why each one could not work.
  useSessionWatch();
  const { mode, toggle } = useColorMode();
  const nav = navTokens[mode];
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const user = { permissions };
  const items = NAV_MODULES.filter((m) => hasPermission(user, m.permission));
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") || "Signed in";

  // mini = icon-only rail (desktop collapsed). Mobile always renders full.
  // overlay = the temporary mobile drawer, which the fixed AppBar sits on top of
  // (zIndex drawer + 1). Repeating the logo there would only get clipped by that
  // bar, so the overlay reserves matching height instead and lets the AppBar's
  // own logo do the branding.
  function navContent(mini: boolean, showCollapse: boolean, overlay = false) {
    return (
      <>
        <Toolbar
          sx={{
            justifyContent: mini ? "center" : "space-between",
            px: mini ? 1 : 2,
            minHeight: overlay
              ? APPBAR_TOOLBAR_MIN_HEIGHT
              : mini
                ? undefined
                : DRAWER_TOOLBAR_MIN_HEIGHT,
          }}
        >
          {!mini && !overlay && (
            <Box
              component="img"
              // Always the white variant: the nav pane is a dark fill in both
              // modes, so the ink logo would disappear against it in light mode.
              src="/mimos-logo-wide-white.webp"
              alt="Mimo's Pet Lounge"
              sx={{
                height: DRAWER_LOGO_HEIGHT,
                width: "auto",
                maxWidth: DRAWER_WIDTH - 72,
                objectFit: "contain",
                display: "block",
                my: 2,
              }}
            />
          )}
          {showCollapse && (
            <IconButton
              onClick={() => setCollapsed((c) => !c)}
              size="small"
              aria-label={mini ? "expand navigation" : "collapse navigation"}
              sx={{
                color: nav.textMuted,
                "&:hover": { backgroundColor: nav.hoverBg },
              }}
            >
              {mini ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          )}
        </Toolbar>
        <Box
          sx={{
            // flex:1 + minHeight:0 rather than height:100%. With height:100% the
            // toolbar's height is added on top of a full-height body, so the pane
            // overflows and the footer collides with the end of the list.
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Only the list scrolls, so the footer stays pinned to the bottom. */}
          <List sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {items.map((item) => {
              const selected = pathname.startsWith(item.href);
              return (
                <ListItem
                  key={item.href}
                  disablePadding
                  sx={{ display: "block" }}
                >
                  <Tooltip
                    title={mini ? item.label : ""}
                    placement="right"
                    disableHoverListener={!mini}
                  >
                    <ListItemButton
                      component={Link}
                      href={item.href}
                      selected={selected}
                      onClick={() => setMobileOpen(false)}
                      sx={{
                        position: "relative",
                        overflow: "visible",
                        justifyContent: mini ? "center" : "flex-start",
                        px: mini ? 1.5 : 2.5,
                        py: 1.25,
                        ml: mini ? 1 : 1.5,
                        mr: mini ? 1 : 0,
                        color: nav.textMuted,
                        borderRadius: mini ? 2 : 0,
                        borderTopLeftRadius: 999,
                        borderBottomLeftRadius: 999,
                        "&:hover": { backgroundColor: nav.hoverBg },
                        "&.Mui-selected": {
                          backgroundColor: nav.activeBg,
                          color: nav.activeText,
                          fontWeight: 700,
                          "&:hover": { backgroundColor: nav.activeBg },
                          // The carved corners only make sense on the full-bleed
                          // pill; the mini rail keeps a plain rounded chip.
                          ...(mini
                            ? {}
                            : {
                                "&::before": notchWedge("top", nav.activeBg),
                                "&::after": notchWedge("bottom", nav.activeBg),
                              }),
                        },
                      }}
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: 0,
                          mr: mini ? 0 : 3,
                          justifyContent: "center",
                          color: "inherit",
                        }}
                      >
                        {ICONS[item.icon]}
                      </ListItemIcon>
                      {!mini && (
                        <ListItemText
                          primary={item.label}
                          slotProps={{
                            primary: {
                              sx: {
                                fontWeight: selected ? 700 : 500,
                                fontSize: 15,
                              },
                            },
                          }}
                        />
                      )}
                    </ListItemButton>
                  </Tooltip>
                </ListItem>
              );
            })}
          </List>

          <Divider sx={{ borderColor: nav.rule, flexShrink: 0 }} />
          <Box sx={{ p: mini ? 1 : 2, color: nav.text, flexShrink: 0 }}>
            {mini ? (
              <Stack spacing={1} sx={{ alignItems: "center" }}>
                <Tooltip
                  title={`${displayName}: change password`}
                  placement="right"
                >
                  <IconButton
                    component={Link}
                    href={ACCOUNT_HREF}
                    aria-label="Your account"
                    sx={{
                      color:
                        pathname === ACCOUNT_HREF ? nav.text : nav.textMuted,
                    }}
                  >
                    <AccountCircleIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  title={mode === "light" ? "Dark mode" : "Light mode"}
                  placement="right"
                >
                  <IconButton
                    aria-label="toggle color mode"
                    onClick={toggle}
                    sx={{ color: nav.textMuted }}
                  >
                    {mode === "light" ? <DarkModeIcon /> : <LightModeIcon />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Sign out" placement="right">
                  <IconButton
                    aria-label="Sign out"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    sx={{ color: nav.textMuted }}
                  >
                    <LogoutIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            ) : (
              <>
                {/* The name is the way in to your own account: there is no
                    module for it in the nav, and every role has one. */}
                <Tooltip title="Your account" placement="right">
                  <Box
                    component={Link}
                    href={ACCOUNT_HREF}
                    onClick={() => setMobileOpen(false)}
                    sx={{
                      display: "block",
                      textDecoration: "none",
                      color: "inherit",
                      borderRadius: 1,
                      px: 1,
                      py: 0.5,
                      mx: -1,
                      backgroundColor:
                        pathname === ACCOUNT_HREF ? nav.hoverBg : "transparent",
                      "&:hover": { backgroundColor: nav.hoverBg },
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", minWidth: 0 }}
                    >
                      <AccountCircleIcon
                        fontSize="small"
                        sx={{ color: nav.textMuted, flexShrink: 0 }}
                      />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ fontWeight: 600 }}
                        >
                          {displayName}
                        </Typography>
                        {roleName && (
                          <Typography
                            variant="caption"
                            noWrap
                            sx={{ display: "block", color: nav.textMuted }}
                          >
                            {roleName}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </Box>
                </Tooltip>
                <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                  <Button
                    fullWidth
                    variant="text"
                    startIcon={
                      mode === "light" ? <DarkModeIcon /> : <LightModeIcon />
                    }
                    onClick={toggle}
                    sx={{
                      justifyContent: "center",
                      color: nav.text,
                      "&:hover": { backgroundColor: nav.hoverBg },
                    }}
                  >
                    {mode === "light" ? "Dark mode" : "Light mode"}
                  </Button>
                  <Button
                    fullWidth
                    variant="text"
                    startIcon={<LogoutIcon />}
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    sx={{
                      justifyContent: "center",
                      color: nav.textMuted,
                      "&:hover": { backgroundColor: nav.hoverBg },
                    }}
                  >
                    Sign out
                  </Button>
                </Stack>
              </>
            )}
          </Box>
        </Box>
      </>
    );
  }

  const desktopWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* Mobile top bar with hamburger */}
      <AppBar
        position="fixed"
        color="default"
        elevation={1}
        sx={{ display: { md: "none" }, zIndex: (t) => t.zIndex.drawer + 1 }}
      >
        <Toolbar sx={{ minHeight: APPBAR_TOOLBAR_MIN_HEIGHT }}>
          <IconButton
            edge="start"
            aria-label="open navigation"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 1 }}
          >
            <MenuIcon />
          </IconButton>
          <Box
            component="img"
            src={
              mode === "dark" ? "/mimos-logo-white.webp" : "/mimos-logo.webp"
            }
            alt="Mimo's Pet Lounge"
            sx={{
              height: APPBAR_LOGO_HEIGHT,
              width: "auto",
              maxWidth: 300,
              objectFit: "contain",
              my: 1,
            }}
          />
        </Toolbar>
      </AppBar>

      {/* Mobile temporary drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            backgroundColor: nav.bg,
            backgroundImage: "none",
            color: nav.text,
            borderRight: "none",
          },
        }}
      >
        {navContent(false, false, true)}
      </Drawer>

      {/* Desktop permanent (collapsible) drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          width: desktopWidth,
          flexShrink: 0,
          whiteSpace: "nowrap",
          "& .MuiDrawer-paper": {
            width: desktopWidth,
            boxSizing: "border-box",
            overflowX: "hidden",
            backgroundColor: nav.bg,
            backgroundImage: "none",
            color: nav.text,
            borderRight: "none",
            transition: (t) =>
              t.transitions.create("width", {
                easing: t.transitions.easing.sharp,
                duration: t.transitions.duration.enteringScreen,
              }),
          },
        }}
      >
        {navContent(collapsed, true)}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>
        {/* Spacer so content clears the fixed mobile AppBar. Its min-height must
            track the AppBar's Toolbar above, hence the shared constant. */}
        <Toolbar
          sx={{
            display: { md: "none" },
            minHeight: APPBAR_TOOLBAR_MIN_HEIGHT,
          }}
        />
        {children}
      </Box>
    </Box>
  );
}
