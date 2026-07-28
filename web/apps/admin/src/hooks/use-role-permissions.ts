import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { access, type ModuleName } from '@genesis/api-client';

export function useRolePermissions(roleId: string | null) {
  return useQuery({
    queryKey: ['access', 'roles', roleId, 'permissions'],
    queryFn: () => access.getRolePermissions(roleId!),
    enabled: roleId !== null,
  });
}

export function useUpdatePermission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      roleId,
      module,
      grant,
    }: {
      roleId: string;
      module: ModuleName;
      grant: { can_view: boolean; can_create: boolean; can_edit: boolean; can_approve: boolean };
    }) => access.updateRolePermission(roleId, module, grant, crypto.randomUUID()),

    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['access', 'roles', variables.roleId, 'permissions'],
      });
    },
  });
}
