import { useMutation, useQueryClient } from "@tanstack/react-query";

type SaveResult<TData> = {
  success: boolean;
  error?: string;
  data?: TData;
};

interface UseConfigSaveMutationOptions<TPayload, TData> {
  queryKeysToInvalidate: string[];
  saveFn: (payload: TPayload) => Promise<SaveResult<TData>>;
  validate?: (payload: TPayload, result: SaveResult<TData>) => void;
  onSuccess?: (result: SaveResult<TData>) => void;
  onError?: (error: Error) => void;
}

export function useConfigSaveMutation<TPayload, TData = unknown>(
  options: UseConfigSaveMutationOptions<TPayload, TData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: TPayload) => {
      const result = await options.saveFn(payload);
      if (!result.success) {
        throw new Error(result.error || "Failed to save");
      }

      if (options.validate) {
        options.validate(payload, result);
      }

      return result;
    },
    onSettled: async () => {
      await Promise.all(
        options.queryKeysToInvalidate.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] })
        )
      );
    },
    onSuccess: (result) => {
      options.onSuccess?.(result as SaveResult<TData>);
    },
    onError: (error) => {
      options.onError?.(error as Error);
    },
  });
}
