/** Cumulato dall'inizio del periodo selezionato. Un mese non disponibile
 * resta assente, senza inventare una chiusura o azzerare i mesi precedenti. */
export function cumulativeSeries(values:readonly (number|null)[]):(number|null)[]{
    let total=0;return values.map(value=>value===null?null:(total+=value));
}
