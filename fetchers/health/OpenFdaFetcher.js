import { OPEN_FDA_BASE_URL } from "../../constants.js";

/**
 * openFDA API fetcher.
 * https://open.fda.gov/apis/ — no auth required (40 req/min),
 * optional API key bumps to 240 req/min (not needed for our use case).
 * Returns drug labels, adverse events, recalls.
 */

// ─── Helpers ───────────────────────────────────────────────────────

function normalizeDrugLabel(r) {
  return {
    brandName: r.openfda?.brand_name?.[0] || null,
    genericName: r.openfda?.generic_name?.[0] || null,
    manufacturer: r.openfda?.manufacturer_name?.[0] || null,
    route: r.openfda?.route || [],
    substanceName: r.openfda?.substance_name || [],
    productType: r.openfda?.product_type?.[0] || null,
    indications: r.indications_and_usage?.[0] || null,
    warnings: r.warnings?.[0] || null,
    adverseReactions: r.adverse_reactions?.[0] || null,
    dosage: r.dosage_and_administration?.[0] || null,
    contraindications: r.contraindications?.[0] || null,
    drugInteractions: r.drug_interactions?.[0] || null,
    pregnancyWarning: r.pregnancy?.[0] || null,
    storageHandling: r.storage_and_handling?.[0] || null,
  };
}

// ─── Search Drug Labels ────────────────────────────────────────────

/**
 * Search FDA drug labels by name (brand or generic).
 * @param {string} query - Drug name
 * @param {number} [limit=5]
 * @returns {Promise<object>}
 */
export async function searchDrugLabels(query, limit = 5) {
  const searchTerm = encodeURIComponent(
    `openfda.brand_name:"${query}"+openfda.generic_name:"${query}"`,
  );
  const url = `${OPEN_FDA_BASE_URL}/drug/label.json?search=${searchTerm}&limit=${Math.min(limit, 20)}`;
  const res = await fetch(url);

  if (res.status === 404) {
    return { found: false, query, drugs: [] };
  }
  if (!res.ok) {
    throw new Error(`openFDA drug labels → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return {
    found: true,
    totalResults: data.meta?.results?.total || 0,
    drugs: (data.results || []).slice(0, limit).map(normalizeDrugLabel),
  };
}

// ─── Get Drug Adverse Events ───────────────────────────────────────

/**
 * Get adverse event reports for a drug.
 * @param {string} drugName - Brand or generic name
 * @param {number} [limit=10]
 * @returns {Promise<object>}
 */
export async function getDrugAdverseEvents(drugName, limit = 10) {
  const searchTerm = encodeURIComponent(
    `patient.drug.openfda.brand_name:"${drugName}"+patient.drug.openfda.generic_name:"${drugName}"`,
  );
  const url = `${OPEN_FDA_BASE_URL}/drug/event.json?search=${searchTerm}&limit=${Math.min(limit, 25)}`;
  const res = await fetch(url);

  if (res.status === 404) {
    return { found: false, drugName, events: [] };
  }
  if (!res.ok) {
    throw new Error(`openFDA adverse events → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return {
    found: true,
    totalResults: data.meta?.results?.total || 0,
    events: (data.results || []).slice(0, limit).map((e) => ({
      safetyReportId: e.safetyreportid || null,
      receiveDate: e.receivedate || null,
      serious: e.serious ? parseInt(e.serious, 10) === 1 : null,
      seriousnessDetails: {
        death: e.seriousnessdeath === "1",
        hospitalization: e.seriousnesshospitalization === "1",
        lifeThreatening: e.seriousnesslifethreatening === "1",
        disability: e.seriousnessdisabling === "1",
      },
      reactions: (e.patient?.reaction || [])
        .map((r) => r.reactionmeddrapt)
        .filter(Boolean)
        .slice(0, 10),
      patientAge: e.patient?.patientonsetage || null,
      patientSex:
        e.patient?.patientsex === "1"
          ? "Male"
          : e.patient?.patientsex === "2"
            ? "Female"
            : null,
    })),
  };
}

// ─── Get Drug Recalls ──────────────────────────────────────────────

/**
 * Get FDA drug recall enforcement actions.
 * @param {string} [query] - Optional search term
 * @param {number} [limit=10]
 * @returns {Promise<object>}
 */
export async function getDrugRecalls(query, limit = 10) {
  let url = `${OPEN_FDA_BASE_URL}/drug/enforcement.json?`;

  if (query) {
    url += `search=reason_for_recall:"${encodeURIComponent(query)}"+openfda.brand_name:"${encodeURIComponent(query)}"&`;
  }
  url += `limit=${Math.min(limit, 25)}&sort=report_date:desc`;

  const res = await fetch(url);

  if (res.status === 404) {
    return { found: false, recalls: [] };
  }
  if (!res.ok) {
    throw new Error(`openFDA recalls → ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return {
    found: true,
    totalResults: data.meta?.results?.total || 0,
    recalls: (data.results || []).slice(0, limit).map((r) => ({
      recallNumber: r.recall_number || null,
      status: r.status || null,
      classification: r.classification || null,
      reportDate: r.report_date || null,
      recallingFirm: r.recalling_firm || null,
      reason: r.reason_for_recall || null,
      productDescription: r.product_description || null,
      distribution: r.distribution_pattern || null,
      voluntaryMandated: r.voluntary_mandated || null,
      city: r.city || null,
      state: r.state || null,
      country: r.country || null,
    })),
  };
}
