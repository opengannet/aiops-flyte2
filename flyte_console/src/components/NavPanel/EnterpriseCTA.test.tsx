import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { AIONE_API_DOCS_URL } from '@/lib/constants'
import { EnterpriseCTA } from './EnterpriseCTA'

describe('EnterpriseCTA', () => {
  it('opens the public API documentation from the wide navigation card', () => {
    render(<EnterpriseCTA size="wide" />)

    const link = screen.getByRole('link', { name: /访问API文档/ })
    expect(link).toHaveAttribute('href', AIONE_API_DOCS_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('查看接口说明')).toBeInTheDocument()
  })
})
