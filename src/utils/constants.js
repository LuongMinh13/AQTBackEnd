// Liste des transporteurs pour les factures (Invoice Processing)
// Chaque transporteur peut définir plusieurs zones d'upload (PDF, Excel, etc.)
export const INVOICE_CARRIERS = [
  {
    slug: "ups",
    name: "UPS",
    label: "Facture UPS",
    uploads: [
      {
        key: "pdf",
        label: "Glissez-déposez vos PDF ici",
        hint: "ou cliquez pour parcourir (plusieurs fichiers possibles)",
        accept: "application/pdf",
        title: "Factures PDF",
        description:
          "Importez un ou plusieurs PDF de factures UPS. Les résultats seront fusionnés dans un seul Excel.",
        required: true,
        multiple: true,
      },
    ],
  },
  {
    slug: "tnt",
    name: "TNT",
    label: "Facture TNT",
    uploads: [
      {
        key: "pdf",
        label: "Glissez-déposez votre PDF ici",
        hint: "ou cliquez pour parcourir",
        accept: "application/pdf",
        title: "Facture PDF (TNT)",
        description: "Importez le PDF de la facture TNT.",
        required: true,
      },
      {
        key: "excel",
        label: "Glissez-déposez votre Excel ici",
        hint: "ou cliquez pour parcourir",
        accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
        title: "Fichier Excel de comparaison",
        description: "Importez le fichier Excel à comparer avec la facture PDF.",
        required: true,
      },
    ],
  },
];

// Liste des transporteurs pour les enlèvements (Pickup Requests)
export const PICKUP_CARRIERS = [
  { slug: "ups", name: "UPS", label: "Enlèvement UPS" },
  { slug: "tnt", name: "TNT", label: "Enlèvement TNT" },
  { slug: "fedex", name: "FedEx", label: "Enlèvement FedEx" },
  { slug: "dhl", name: "DHL", label: "Enlèvement DHL" },
];

// Récupère les infos d'un transporteur depuis son slug
export const getCarrierByslug = (list, slug) =>
  list.find((c) => c.slug === slug);

// Routes principales
export const ROUTES = {
  dashboard: "/",
  invoices: "/invoices",
  invoice: (slug) => `/invoices/${slug}`,
  pickups: "/pickups",
  pickup: (slug) => `/pickups/${slug}`,
  palettes: "/palettes",
  connection: "/connection",
};
