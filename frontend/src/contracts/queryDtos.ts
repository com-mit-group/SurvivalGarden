export type TaxonomyPickerCrop = { cropId: string; cropName: string; speciesId: string; speciesDisplay: string };
export type TaxonomyPickerCultivar = { cultivarId: string; cultivarName: string; cropTypeId: string; cropTypeName: string; speciesDisplay: string; archived: boolean };
export type TaxonomyPickerQueryResponse = {
  crops: TaxonomyPickerCrop[];
  cultivars: TaxonomyPickerCultivar[];
};
export type BatchListQueryRow = {
  batchId: string;
  identityId: string;
  capabilityCropId: string;
  displayName: string;
  cropTypeId: string;
  cropTypeName: string;
  speciesDisplay: string;
};
