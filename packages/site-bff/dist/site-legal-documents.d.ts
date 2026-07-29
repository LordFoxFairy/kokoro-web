export type SiteLegalDocument = Readonly<{
    termRef: string;
    label: string;
    href: string;
}>;
export type PublicLegalDocument = Readonly<{
    label: string;
    href: string;
}>;
/** The deployment projection of the SiteRelease legal-document registry. Invalid input fails closed. */
export declare function parseSiteLegalDocuments(raw: string | undefined): readonly SiteLegalDocument[];
export declare function publicLegalDocuments(documents: readonly SiteLegalDocument[]): readonly PublicLegalDocument[];
//# sourceMappingURL=site-legal-documents.d.ts.map