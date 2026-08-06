/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { type Metadata } from "next";

import { CreateModelAppPage } from "@/components/pages/ListApps/CreateModelAppPage";

export const metadata: Metadata = {
  title: "创建模型应用",
};

export default function Home() {
  return <CreateModelAppPage />;
}
