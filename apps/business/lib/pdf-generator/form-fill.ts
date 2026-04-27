import { PDFDocument } from 'pdf-lib'
import { z } from 'zod'

const FormParamsSchema = z.object({
    type: z.enum(['partner-agreement', 'dpa']),
    version: z.string().regex(/^v\d+(\.\d+)*$/, 'Version must be in format v1 or v1.2'),
})

const CDN_BASE = 'https://cdn.openbookings.co'

export async function handleExport(type: string, version: string): Promise<Uint8Array> {
    const { type: safeType, version: safeVersion } = FormParamsSchema.parse({ type, version })

    const formUrl = new URL(`/${safeType}/${safeVersion}.pdf`, CDN_BASE).toString()

    const response = await fetch(formUrl)
    if (!response.ok) {
        throw new Error(`Failed to fetch form template: ${response.status}`)
    }

    const formPdfBytes = await response.arrayBuffer()

    const pdfDoc = await PDFDocument.load(formPdfBytes)

    const form = pdfDoc.getForm()
    form.getTextField('legal_company_name').setText("Hello World")
    form.getTextField('full_name_signee').setText("Maxime Soede")
    form.getTextField('role_title').setText("Front Office Manager")
    form.flatten()

    return pdfDoc.save()
}