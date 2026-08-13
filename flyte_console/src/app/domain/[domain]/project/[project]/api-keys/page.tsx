import { type Metadata } from "next";
import { ApiKeysPage } from "@/components/pages/ApiKeys/Page";

export const metadata: Metadata = {
  title: "API Keys",
};

export default function Page() {
  return <ApiKeysPage publicURL={process.env.AIONE_PUBLIC_URL ?? ""} />;
}
