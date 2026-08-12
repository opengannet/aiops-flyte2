import { SwaggerUi } from "@/components/AioneApiDocs/SwaggerUi";

export const metadata = {
  title: "AIONE REST API 文档 | Flyte 2",
  description: "AIONE 外部 REST API 的 OpenAPI 3.1 文档与在线调试页面。",
};

export default function ApiDocsPage() {
  return (
    <main>
      <link rel="stylesheet" href="/v2/swagger-ui/swagger-ui.css" />
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
        <span> 在右上角 Authorize 中输入 API key；密钥只保留在浏览器 Swagger UI 会话中，不会写入服务端日志或本接口规范。</span>
      </section>
      <SwaggerUi />
    </main>
  );
}
