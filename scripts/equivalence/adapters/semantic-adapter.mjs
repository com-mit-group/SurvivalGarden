import { api, assertSuccessfulResponse } from './http.mjs';

export function createSemanticAdapter(name, baseUrl, mappingOverrides = {}) {
  const operations = {
    ...defaultOperations,
    ...mappingOverrides,
  };

  return {
    name,
    async resetState(fixture) {
      const response = await api(baseUrl, 'PUT', '/api/app-state', fixture);
      assertSuccessfulResponse(name, 'PUT /api/app-state', response);
      return response;
    },
    async loadFinalState() {
      const response = await api(baseUrl, 'GET', '/api/app-state');
      assertSuccessfulResponse(name, 'GET /api/app-state', response);
      return response;
    },
    async executeStep(step) {
      const operation = operations[step.op];
      if (!operation) {
        throw new Error(`Unsupported ${name} op: ${step.op}`);
      }

      return operation({ baseUrl, runtimeName: name }, step.input ?? {});
    },
  };
}

const defaultOperations = {
  createSpecies: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/species/${input.id}`, {
      id: input.id,
      name: input.name,
    }),

  createCrop: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/crops/${input.id}`, {
      cropId: input.id,
      speciesId: input.speciesId,
      name: input.name,
    }),

  createCultivar: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/cultivars/${input.id}`, {
      id: input.id,
      cropId: input.cropId,
      name: input.name,
    }),

  createSegment: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/segments/${input.id}`, {
      segmentId: input.id,
      name: input.name,
      surface: input.surface,
    }),

  createBed: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/beds/${input.id}`, {
      bedId: input.id,
      segmentId: input.segmentId,
      name: input.name,
    }),

  createPath: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/paths/${input.id}`, {
      pathId: input.id,
      segmentId: input.segmentId,
      name: input.name,
    }),

  createBatch: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/batches/${input.batchId}`, {
      batchId: input.batchId,
      cropId: input.cropId,
      stage: input.stage,
      startedAt: input.startedAt,
      assignments: input.assignments ?? [],
    }),

  assignBatchToBed: async ({ baseUrl, runtimeName }, input) => {
    const existingResponse = await api(baseUrl, 'GET', `/api/batches/${input.batchId}`);
    assertSuccessfulResponse(runtimeName, `GET /api/batches/${input.batchId}`, existingResponse);

    const existingBatch = existingResponse.body ?? { batchId: input.batchId, assignments: [] };
    const assignments = Array.isArray(existingBatch.assignments) ? [...existingBatch.assignments] : [];
    assignments.push({ bedId: input.bedId, assignedAt: input.assignedAt });

    return api(baseUrl, 'PUT', `/api/batches/${input.batchId}`, {
      ...existingBatch,
      assignments,
    });
  },

  listBatchesByBed: ({ baseUrl }, input) => {
    const query = new URLSearchParams({ bedId: input.bedId }).toString();
    return api(baseUrl, 'GET', `/api/batches?${query}`);
  },

  createSeedInventoryItem: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/seedInventoryItems/${input.id}`, {
      seedInventoryItemId: input.id,
      cultivarId: input.cultivarId,
      quantity: input.quantity,
      unit: input.unit,
    }),

  createCropPlan: ({ baseUrl }, input) =>
    api(baseUrl, 'PUT', `/api/cropPlans/${input.id}`, {
      planId: input.id,
      cropId: input.cropId,
      bedId: input.bedId,
      plannedDate: input.plannedDate,
    }),

  validateBatch: ({ baseUrl }, input) => api(baseUrl, 'POST', '/api/validate/batches', input),

  reloadState: ({ baseUrl }) => api(baseUrl, 'GET', '/api/app-state'),
};
