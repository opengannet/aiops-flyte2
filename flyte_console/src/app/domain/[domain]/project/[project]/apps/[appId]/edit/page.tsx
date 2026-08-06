/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import type { Metadata } from "next";

import { EditModelAppPage } from "@/components/pages/ListApps/EditModelAppPage";

export const metadata: Metadata = {
  title: "编辑模型应用",
};

export default function Home() {
  return <EditModelAppPage />;
}
