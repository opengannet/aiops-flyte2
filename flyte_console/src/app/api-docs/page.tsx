import { ScalarApiReference } from "@/components/AioneApiDocs/ScalarApiReference";

export const metadata = {
  title: "AIONE REST API 文档 | Flyte 2",
  description: "AIONE 外部 REST API 的 OpenAPI 3.1 文档与在线调试页面。",
};

export default function ApiDocsPage() {
  return (
    <main>
      <link rel="icon" href="/v2/union-192x192.png" />
      <section
        style={{
          background: "#7f1d1d",
          color: "#fff",
          fontFamily: "sans-serif",
          padding: "16px 24px",
        }}
      >
        <strong>注意：在线调试可能创建、停止或清理计算资源。</strong>
        <span>
          {" "}
          请在 Scalar 的 Authentication 面板中输入 API key；密钥只保留在浏览器中，不会写入服务端日志或 OpenAPI 合约。
        </span>
      </section>
      <ScalarApiReference />
    </main>
  );
}
