import { describe, expect, it } from 'vitest'
import {
  formatTotalLabel,
  getPhaseLabel,
  getUiText,
  translateDataLabel,
} from './uiText'

describe('Chinese UI text helpers', () => {
  it('returns Chinese labels for shared console text', () => {
    expect(getUiText('projects')).toBe('项目')
    expect(getUiText('runs')).toBe('运行')
    expect(getUiText('triggers')).toBe('触发器')
    expect(getUiText('searchRuns')).toBe('搜索运行')
  })

  it('formats counts and empty-state data labels in Chinese', () => {
    expect(formatTotalLabel(3)).toBe('共 3 个')
    expect(translateDataLabel('projects')).toBe('项目')
    expect(translateDataLabel('triggers')).toBe('触发器')
  })

  it('returns Chinese phase labels', () => {
    expect(getPhaseLabel('SUCCEEDED')).toBe('成功')
    expect(getPhaseLabel('WAITING_FOR_RESOURCES')).toBe('等待资源')
  })
})
