import { accounts } from "./schema/accounts";
import { apiKeys } from "./schema/api-keys";
import { endpointTools } from "./schema/endpoint-tools";
import { endpointModeEnum, endpoints } from "./schema/endpoints";
import { sessions } from "./schema/sessions";
import { cacheStatusEnum, executionStatusEnum, toolExecutions } from "./schema/tool-executions";
import { toolSourceKindEnum, toolSourceStatusEnum, toolSources } from "./schema/tool-sources";
import { tools } from "./schema/tools";
import { userRoleEnum, users } from "./schema/users";
import { verifications } from "./schema/verifications";

export const schema = {
  userRoleEnum,
  users,
  sessions,
  accounts,
  verifications,
  toolSourceKindEnum,
  toolSourceStatusEnum,
  toolSources,
  tools,
  endpointModeEnum,
  endpoints,
  endpointTools,
  apiKeys,
  cacheStatusEnum,
  executionStatusEnum,
  toolExecutions,
};
