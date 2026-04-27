export interface SignerDetails {
    legalCompanyName: string
    fullName: string
    roleTitle: string
    signedAt: string
}

export async function handleExport(
    docId: 'partner-agreement' | 'dpa',
    signerDetails: SignerDetails,
): Promise<Uint8Array> {
    const INTERNAL_DPA_URL = process.env.DPA_URL
    const INTERNAL_PA_URL = process.env.PA_URL

    let templateUrl: string | undefined

    if (docId === 'partner-agreement') {
        templateUrl = INTERNAL_PA_URL
    } else if (docId === 'dpa') {
        templateUrl = INTERNAL_DPA_URL
    } else {
        throw new Error('Cannot process requested document')
    }

    if (!templateUrl) {
        throw new Error('Template URL is not defined')
    }

    const res = await fetch(templateUrl as string)
    if (!res.ok) {
        throw new Error(`Failed to fetch template: ${res.status} ${templateUrl}`)
    }

    const template = await res.text()

    const html = template
        .replaceAll('{{COMPANY_NAME}}', signerDetails.legalCompanyName)
        .replaceAll('{{REPRESENTATIVE_NAME}}', signerDetails.fullName)
        .replaceAll('{{REPRESENTATIVE_TITLE}}', signerDetails.roleTitle)
        .replaceAll('{{DATE_OF_SIGNATURE}}', signerDetails.signedAt)
        
    const GOTENBERG_URL = process.env.GOTENBERG_URL

    const form = new FormData()
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')

    const res2 = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
        method: 'POST',
        body: form,
    })

    if (!res2.ok) {
        throw new Error(`Gotenberg PDF generation failed: ${res2.status}`)
    }

    return new Uint8Array(await res2.arrayBuffer())
}
