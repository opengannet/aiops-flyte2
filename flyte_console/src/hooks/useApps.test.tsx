/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import '@testing-library/jest-dom/vitest'
import { create } from '@bufbuild/protobuf'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppSchema } from '@/gen/flyteidl2/app/app_definition_pb'
import { useDeleteApp } from './useApps'

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
}))

vi.mock('./useConnectRpc', () => ({
  useConnectRpcClient: () => ({ delete: mocks.delete }),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('useDeleteApp', () => {
  it('deletes by app identifier and invalidates the project app list', async () => {
    mocks.delete.mockResolvedValueOnce({})
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const queryKey = ['apps', 'aione', 'project-a', 'development']
    queryClient.setQueryData(queryKey, { apps: [] })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const app = create(AppSchema, {
      metadata: {
        id: {
          domain: 'development',
          name: 'qwen25-15b',
          org: 'aione',
          project: 'project-a',
        },
      },
    })
    const { result } = renderHook(() => useDeleteApp({ app }), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mocks.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: expect.objectContaining({ name: 'qwen25-15b' }),
      }),
    )
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
  })
})
