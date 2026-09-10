"use client";

import Link from "@/components/ui/AppLink";
import { usePathname } from "next/navigation";
import { Tab, Tabs } from "@mui/material";
import { NOTIFICATION_TABS } from "@/constants/notification";

// Route-backed tab bar: each tab is a prefetched Link to /notifications/<slug>,
// so switching tabs is an instant client navigation and every tab deep-links.
export default function NotificationsTabs() {
  const pathname = usePathname();
  const active = NOTIFICATION_TABS.findIndex(
    (t) => pathname === `/notifications/${t.slug}`,
  );

  return (
    <Tabs
      value={active === -1 ? 0 : active}
      variant="scrollable"
      scrollButtons={false}
      allowScrollButtonsMobile
      sx={{ mb: 2 }}
    >
      {NOTIFICATION_TABS.map((t) => (
        <Tab
          key={t.slug}
          label={t.label}
          component={Link}
          href={`/notifications/${t.slug}`}
        />
      ))}
    </Tabs>
  );
}
