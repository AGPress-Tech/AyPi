export const ARTICLE_ORDER_COLUMNS = [
    {key:'article',label:'Articolo',kind:'text',required:true},
    {key:'description',label:'Descrizione articolo',kind:'text'},
    {key:'orderNo',label:'N. ordine',kind:'text'},
    {key:'line',label:'Riga',kind:'number'},
    {key:'orderDate',label:'Data ordine',kind:'date'},
    {key:'deliveryDate',label:'Consegna prevista',kind:'date'},
    {key:'quantity',label:'Quantità',kind:'number'},
    {key:'unit',label:'U.M.',kind:'text'},
    {key:'deliveredQuantity',label:'Quantità consegnata',kind:'number'},
    {key:'residual',label:'Residuo da evadere',kind:'number'},
    {key:'delivered',label:'Consegnato',kind:'boolean'},
    {key:'unitPrice',label:'Prezzo unitario',kind:'money'},
    {key:'netPrice',label:'Prezzo netto',kind:'money'},
    {key:'currency',label:'Valuta',kind:'text'},
    {key:'customerCode',label:'Codice cliente',kind:'text'},
    {key:'customerName',label:'Ragione sociale',kind:'text'},
    {key:'cancelled',label:'Annullato',kind:'boolean'},
] as const;
export const DEFAULT_ARTICLE_ORDER_COLUMNS=['article','orderNo','orderDate','deliveryDate','quantity','unit','residual','delivered','unitPrice','currency','customerCode','customerName'];
export type ArticleDocumentColumn={key:string;label:string;kind:'text'|'date'|'number'|'money'|'boolean'};
export const ARTICLE_OFFER_COLUMNS:readonly ArticleDocumentColumn[]=[
    {key:'article',label:'Articolo',kind:'text'},
    {key:'description',label:'Descrizione articolo',kind:'text'},
    {key:'offerNo',label:'N. offerta',kind:'text'},
    {key:'line',label:'Riga',kind:'number'},
    {key:'offerDate',label:'Data offerta',kind:'date'},
    {key:'customerCode',label:'Codice cliente / contatto',kind:'text'},
    {key:'customerName',label:'Cliente',kind:'text'},
    {key:'customerType',label:'Tipo destinatario',kind:'text'},
    {key:'quantity',label:'Quantità offerta',kind:'number'},
    {key:'unit',label:'U.M.',kind:'text'},
    {key:'unitPrice',label:'Prezzo offerto',kind:'money'},
    {key:'netPrice',label:'Prezzo netto',kind:'money'},
    {key:'currency',label:'Valuta',kind:'text'},
];
export const DEFAULT_ARTICLE_OFFER_COLUMNS=['article','offerNo','offerDate','customerCode','customerName','quantity','unit','unitPrice','currency'];
