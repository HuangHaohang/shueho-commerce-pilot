"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  activateProductImport,
  getProductCatalog,
  getLatestProductImport,
  importProducts,
  type ActivateProductImportInput,
  type ImportProductsInput,
  type ProductCatalogQuery,
} from "./catalog";
import {
  createProductSource,
  getProductConnectors,
  getProductSources,
  testProductSource,
  type CreateProductSourceInput,
} from "./sources";

export const productCatalogQueryKey = ["product-catalog"] as const;
export const latestProductImportQueryKey = ["product-latest-import"] as const;
export const productConnectorsQueryKey = ["product-connectors"] as const;
export const productSourcesQueryKey = ["product-sources"] as const;

export function useProductCatalog(input: ProductCatalogQuery = {}, enabled = true) {
  return useQuery({
    queryKey: [...productCatalogQueryKey, input.query?.trim() ?? "", input.limit ?? 40, input.cursor ?? null],
    queryFn: ({ signal }) => getProductCatalog(input, signal),
    enabled,
    retry: (failureCount, error) => {
      if (typeof error === "object" && error && "status" in error && error.status === 403) return false;
      return failureCount < 1;
    },
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useProductImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportProductsInput) => importProducts(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productCatalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: latestProductImportQueryKey }),
      ]);
    },
  });
}

export function useLatestProductImport(enabled = true) {
  return useQuery({
    queryKey: latestProductImportQueryKey,
    queryFn: ({ signal }) => getLatestProductImport(signal),
    enabled,
    retry: false,
    staleTime: 10_000,
  });
}

export function useActivateProductImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ActivateProductImportInput) => activateProductImport(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productCatalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: latestProductImportQueryKey }),
      ]);
    },
  });
}

export function useProductConnectors(enabled = true) {
  return useQuery({
    queryKey: productConnectorsQueryKey,
    queryFn: ({ signal }) => getProductConnectors(signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useProductSources(enabled = true) {
  return useQuery({
    queryKey: productSourcesQueryKey,
    queryFn: ({ signal }) => getProductSources(signal),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export function useCreateProductSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductSourceInput) => createProductSource(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productSourcesQueryKey }),
        queryClient.invalidateQueries({ queryKey: productCatalogQueryKey }),
      ]);
    },
  });
}

export function useTestProductSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, idempotencyKey }: { sourceId: string; idempotencyKey: string }) =>
      testProductSource(sourceId, idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productSourcesQueryKey });
    },
  });
}
