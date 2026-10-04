// Admitted public outcomes per resolved mode (ADR 0013 section 6, ADR 0010 section 1, ADR 0006 section 1).
//
//   MOA-independent, nonempty, Precise : optimal / certified_optimal / exact / moa null
//   MOA-independent, empty,    Precise : infeasible / certified_infeasible / exact
//   MOA-independent, nonempty, Fast    : optimal / approximate_optimal / approximate
//   MOA-independent, empty,    Fast    : incomplete / none / approximate, 'Approximate model infeasible'
//   MOA-dependent,   nonempty, Precise : optimal / approximate_optimal / exact + provisional_model
//   MOA-dependent,   empty,    Precise : incomplete / none, 'Provisional MOA model infeasible'
//   MOA-dependent,   nonempty, Fast    : optimal / approximate_optimal / approximate + provisional_model
//   MOA-dependent,   empty,    Fast    : incomplete / none, 'Fast provisional MOA model infeasible'
//
// Every completed executed search, emptiness included, terminates `optimal` (search completion
// only); the certificate and reason carry the authority fences.

import type { AdmittedOutcome, AdmittedOutcomes } from './types';

export function admittedFor(moaDependent: boolean, empty: boolean): AdmittedOutcomes {
  const moa = moaDependent ? 'provisional_model' : null;
  const precise: AdmittedOutcome = empty
    ? moaDependent
      ? { status: 'incomplete', physical_certificate: 'none', model_qualification: 'exact', moa_qualification: moa, termination: 'optimal', reason: 'Provisional MOA model infeasible' }
      : { status: 'infeasible', physical_certificate: 'certified_infeasible', model_qualification: 'exact', moa_qualification: moa, termination: 'optimal', reason: null }
    : {
        status: 'optimal',
        physical_certificate: moaDependent ? 'approximate_optimal' : 'certified_optimal',
        model_qualification: 'exact',
        moa_qualification: moa,
        termination: 'optimal',
        reason: null,
      };
  const fast: AdmittedOutcome = empty
    ? {
        status: 'incomplete',
        physical_certificate: 'none',
        model_qualification: 'approximate',
        moa_qualification: moa,
        termination: 'optimal',
        reason: moaDependent ? 'Fast provisional MOA model infeasible' : 'Approximate model infeasible',
      }
    : { status: 'optimal', physical_certificate: 'approximate_optimal', model_qualification: 'approximate', moa_qualification: moa, termination: 'optimal', reason: null };
  return { precise, fast };
}
