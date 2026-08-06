GRANT EXECUTE ON FUNCTION private.portal_scope_surgeon_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.portal_surgeon_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_portal_role(uuid, portal_role) TO authenticated, service_role;