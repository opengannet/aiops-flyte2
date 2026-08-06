/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { CopyButton } from '@/components/CopyButton'
import { ArrowTopRightIcon } from '@/components/icons/ArrowTopRightIcon'
import { TableState } from '@/components/Tables'
import { useListApps } from '@/hooks/useApps'
import { FLYTE_DOCS_APPS_URL } from '@/lib/constants'
import {
  flyteCliNeedsInsecure,
  getFlyteCliEndpointHost,
  getLocation,
} from '@/lib/windowUtils'
import { ProjectDomainPageParams } from '@/types/pageParams'
import { python } from '@codemirror/lang-python'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ListAppsTable } from './table/ListAppsTable'

type ListAppsContentProps = {
  listAppsQuery: ReturnType<typeof useListApps>
  searchQuery: string
}

const useCodeSnippets = () => {
  const params = useParams<ProjectDomainPageParams>()
  const { hostname } = getLocation()
  const endpointHost = getFlyteCliEndpointHost(hostname, params.domain)
  const needsInsecure = flyteCliNeedsInsecure(endpointHost)
  return [
    {
      id: '1',
      label: '如果本地没有 Flyte 配置，请先运行以下命令创建：',
      code: `flyte create config \\
    --endpoint ${endpointHost} \\
    --project ${params.project} \\
    --domain ${params.domain} \\
    --builder local${needsInsecure ? ' \\\n    --insecure' : ''}`,
    },
    {
      id: '2',
      label: '然后创建名为 app.py 的应用脚本：',
      code: `import flyte
import flyte.app

image = flyte.Image.from_debian_base(python_version=(3, 12)).with_pip_packages("streamlit==1.41.1")

# “App” 声明。
# 使用上面声明的 “ImageSpec”。
# 在此示例中，无需提供任何应用代码，
# 因为我们使用 Streamlit 内置的 “hello” 应用。
app_env = flyte.app.AppEnvironment(
    name="streamlit-hello",
    image=image,
    command="streamlit hello --server.port 8080",
    resources=flyte.Resources(cpu="1", memory="1Gi"),
)`,
    },
    {
      id: '3',
      label: '然后运行应用：',
      code: `flyte serve app.py app_env`,
    },
  ]
}

export const ListAppsContent = ({
  listAppsQuery,
  searchQuery,
}: ListAppsContentProps) => {
  const { resolvedTheme } = useTheme()
  const codeSnippets = useCodeSnippets()

  return (
    <TableState
      data={listAppsQuery.data?.apps}
      dataLabel="apps"
      isError={listAppsQuery.isError}
      isLoading={listAppsQuery.isLoading}
      searchQuery={searchQuery}
      subtitle="应用让您能够构建和运行自己的 Web 应用，包括模型端点、AI 推理组件、交互式仪表板、连接器等。"
      content={
        <div>
          <Link
            target="_blank"
            href={FLYTE_DOCS_APPS_URL}
            className="flex items-center justify-center gap-2 p-3 text-sm"
          >
            <span>如何创建应用</span>
            <ArrowTopRightIcon className="h-2.125 w-2" />
          </Link>
          <div className="max-w-[600px] min-w-[550px]">
            {codeSnippets.map(({ code, id, label }) => (
              <div key={id} className="mt-6 w-full">
                <p className="text-sm font-bold">{label}</p>
                <div className="relative mt-2 w-full text-[11px] [&_.cm-editor]:!bg-transparent [&_.cm-focused]:!outline-none [&_.cm-gutters]:!bg-transparent [&_.cm-scroller]:!rounded-2xl [&_.cm-scroller]:!border [&_.cm-scroller]:!border-(--system-white)/14 [&_.cm-scroller>:where(.cm-content)]:!p-5">
                  <div className="pointer-events-auto absolute top-3 right-3 z-20">
                    <CopyButton value={code} />
                  </div>
                  <CodeMirror
                    readOnly
                    editable={false}
                    theme={resolvedTheme === 'dark' ? vscodeDark : vscodeLight}
                    extensions={[python(), EditorView.lineWrapping]}
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                      highlightActiveLine: false,
                      highlightActiveLineGutter: false,
                    }}
                    value={code}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      }
    >
      {(data) => <ListAppsTable data={data} />}
    </TableState>
  )
}
