from buf.validate import validate_pb2 as _validate_pb2
from flyteidl2.aione.cloudstorage import cloud_storage_definition_pb2 as _cloud_storage_definition_pb2
from flyteidl2.app import app_definition_pb2 as _app_definition_pb2
from flyteidl2.common import identifier_pb2 as _identifier_pb2
from flyteidl2.common import list_pb2 as _list_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CreateRequest(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class CreateModelAppRequest(_message.Message):
    __slots__ = ["model"]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    model: ModelAppInput
    def __init__(self, model: _Optional[_Union[ModelAppInput, _Mapping]] = ...) -> None: ...

class ModelAppInput(_message.Message):
    __slots__ = ["org", "project", "domain", "name", "id", "code", "image", "param", "codes", "resource_definition", "cloud_storage_mounts", "model_cache_size"]
    ORG_FIELD_NUMBER: _ClassVar[int]
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    PARAM_FIELD_NUMBER: _ClassVar[int]
    CODES_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_DEFINITION_FIELD_NUMBER: _ClassVar[int]
    CLOUD_STORAGE_MOUNTS_FIELD_NUMBER: _ClassVar[int]
    MODEL_CACHE_SIZE_FIELD_NUMBER: _ClassVar[int]
    org: str
    project: str
    domain: str
    name: str
    id: str
    code: str
    image: str
    param: str
    codes: _containers.RepeatedCompositeFieldContainer[ModelCodeSource]
    resource_definition: ModelResourceDefinition
    cloud_storage_mounts: _containers.RepeatedCompositeFieldContainer[_cloud_storage_definition_pb2.CloudStorageMount]
    model_cache_size: str
    def __init__(self, org: _Optional[str] = ..., project: _Optional[str] = ..., domain: _Optional[str] = ..., name: _Optional[str] = ..., id: _Optional[str] = ..., code: _Optional[str] = ..., image: _Optional[str] = ..., param: _Optional[str] = ..., codes: _Optional[_Iterable[_Union[ModelCodeSource, _Mapping]]] = ..., resource_definition: _Optional[_Union[ModelResourceDefinition, _Mapping]] = ..., cloud_storage_mounts: _Optional[_Iterable[_Union[_cloud_storage_definition_pb2.CloudStorageMount, _Mapping]]] = ..., model_cache_size: _Optional[str] = ...) -> None: ...

class ModelCodeSource(_message.Message):
    __slots__ = ["id", "branch", "path", "token"]
    ID_FIELD_NUMBER: _ClassVar[int]
    BRANCH_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    id: str
    branch: str
    path: str
    token: str
    def __init__(self, id: _Optional[str] = ..., branch: _Optional[str] = ..., path: _Optional[str] = ..., token: _Optional[str] = ...) -> None: ...

class ModelResourceDefinition(_message.Message):
    __slots__ = ["cpu", "memory", "gpu", "gpu_key", "gpu_node_label_key"]
    CPU_FIELD_NUMBER: _ClassVar[int]
    MEMORY_FIELD_NUMBER: _ClassVar[int]
    GPU_FIELD_NUMBER: _ClassVar[int]
    GPU_KEY_FIELD_NUMBER: _ClassVar[int]
    GPU_NODE_LABEL_KEY_FIELD_NUMBER: _ClassVar[int]
    cpu: str
    memory: str
    gpu: int
    gpu_key: str
    gpu_node_label_key: str
    def __init__(self, cpu: _Optional[str] = ..., memory: _Optional[str] = ..., gpu: _Optional[int] = ..., gpu_key: _Optional[str] = ..., gpu_node_label_key: _Optional[str] = ...) -> None: ...

class ModelCodeSourceView(_message.Message):
    __slots__ = ["id", "branch", "path", "token_configured"]
    ID_FIELD_NUMBER: _ClassVar[int]
    BRANCH_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    TOKEN_CONFIGURED_FIELD_NUMBER: _ClassVar[int]
    id: str
    branch: str
    path: str
    token_configured: bool
    def __init__(self, id: _Optional[str] = ..., branch: _Optional[str] = ..., path: _Optional[str] = ..., token_configured: bool = ...) -> None: ...

class ModelCachePVC(_message.Message):
    __slots__ = ["name", "storage_class_name", "requested_size", "capacity", "expandable"]
    NAME_FIELD_NUMBER: _ClassVar[int]
    STORAGE_CLASS_NAME_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_SIZE_FIELD_NUMBER: _ClassVar[int]
    CAPACITY_FIELD_NUMBER: _ClassVar[int]
    EXPANDABLE_FIELD_NUMBER: _ClassVar[int]
    name: str
    storage_class_name: str
    requested_size: str
    capacity: str
    expandable: bool
    def __init__(self, name: _Optional[str] = ..., storage_class_name: _Optional[str] = ..., requested_size: _Optional[str] = ..., capacity: _Optional[str] = ..., expandable: bool = ...) -> None: ...

class ModelAppConfig(_message.Message):
    __slots__ = ["app_id", "name", "code", "image", "param", "codes", "resource_definition", "cloud_storage_mounts", "model_cache_pvc"]
    APP_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    PARAM_FIELD_NUMBER: _ClassVar[int]
    CODES_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_DEFINITION_FIELD_NUMBER: _ClassVar[int]
    CLOUD_STORAGE_MOUNTS_FIELD_NUMBER: _ClassVar[int]
    MODEL_CACHE_PVC_FIELD_NUMBER: _ClassVar[int]
    app_id: _app_definition_pb2.Identifier
    name: str
    code: str
    image: str
    param: str
    codes: _containers.RepeatedCompositeFieldContainer[ModelCodeSourceView]
    resource_definition: ModelResourceDefinition
    cloud_storage_mounts: _containers.RepeatedCompositeFieldContainer[_cloud_storage_definition_pb2.CloudStorageMount]
    model_cache_pvc: ModelCachePVC
    def __init__(self, app_id: _Optional[_Union[_app_definition_pb2.Identifier, _Mapping]] = ..., name: _Optional[str] = ..., code: _Optional[str] = ..., image: _Optional[str] = ..., param: _Optional[str] = ..., codes: _Optional[_Iterable[_Union[ModelCodeSourceView, _Mapping]]] = ..., resource_definition: _Optional[_Union[ModelResourceDefinition, _Mapping]] = ..., cloud_storage_mounts: _Optional[_Iterable[_Union[_cloud_storage_definition_pb2.CloudStorageMount, _Mapping]]] = ..., model_cache_pvc: _Optional[_Union[ModelCachePVC, _Mapping]] = ...) -> None: ...

class GetModelAppConfigRequest(_message.Message):
    __slots__ = ["app_id"]
    APP_ID_FIELD_NUMBER: _ClassVar[int]
    app_id: _app_definition_pb2.Identifier
    def __init__(self, app_id: _Optional[_Union[_app_definition_pb2.Identifier, _Mapping]] = ...) -> None: ...

class GetModelAppConfigResponse(_message.Message):
    __slots__ = ["model"]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    model: ModelAppConfig
    def __init__(self, model: _Optional[_Union[ModelAppConfig, _Mapping]] = ...) -> None: ...

class UpdateModelAppRequest(_message.Message):
    __slots__ = ["app_id", "name", "image", "param", "resource_definition", "cloud_storage_mounts", "reason", "model_cache_size"]
    APP_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    PARAM_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_DEFINITION_FIELD_NUMBER: _ClassVar[int]
    CLOUD_STORAGE_MOUNTS_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    MODEL_CACHE_SIZE_FIELD_NUMBER: _ClassVar[int]
    app_id: _app_definition_pb2.Identifier
    name: str
    image: str
    param: str
    resource_definition: ModelResourceDefinition
    cloud_storage_mounts: _containers.RepeatedCompositeFieldContainer[_cloud_storage_definition_pb2.CloudStorageMount]
    reason: str
    model_cache_size: str
    def __init__(self, app_id: _Optional[_Union[_app_definition_pb2.Identifier, _Mapping]] = ..., name: _Optional[str] = ..., image: _Optional[str] = ..., param: _Optional[str] = ..., resource_definition: _Optional[_Union[ModelResourceDefinition, _Mapping]] = ..., cloud_storage_mounts: _Optional[_Iterable[_Union[_cloud_storage_definition_pb2.CloudStorageMount, _Mapping]]] = ..., reason: _Optional[str] = ..., model_cache_size: _Optional[str] = ...) -> None: ...

class UpdateModelAppResponse(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class CreateResponse(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class GetRequest(_message.Message):
    __slots__ = ["app_id", "ingress"]
    APP_ID_FIELD_NUMBER: _ClassVar[int]
    INGRESS_FIELD_NUMBER: _ClassVar[int]
    app_id: _app_definition_pb2.Identifier
    ingress: _app_definition_pb2.Ingress
    def __init__(self, app_id: _Optional[_Union[_app_definition_pb2.Identifier, _Mapping]] = ..., ingress: _Optional[_Union[_app_definition_pb2.Ingress, _Mapping]] = ...) -> None: ...

class GetResponse(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class UpdateRequest(_message.Message):
    __slots__ = ["app", "reason"]
    APP_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    reason: str
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ..., reason: _Optional[str] = ...) -> None: ...

class UpdateResponse(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class DeleteRequest(_message.Message):
    __slots__ = ["app_id"]
    APP_ID_FIELD_NUMBER: _ClassVar[int]
    app_id: _app_definition_pb2.Identifier
    def __init__(self, app_id: _Optional[_Union[_app_definition_pb2.Identifier, _Mapping]] = ...) -> None: ...

class DeleteResponse(_message.Message):
    __slots__ = []
    def __init__(self) -> None: ...

class ConsumedArtifactFilter(_message.Message):
    __slots__ = ["project", "domain", "name", "version"]
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    project: str
    domain: str
    name: str
    version: str
    def __init__(self, project: _Optional[str] = ..., domain: _Optional[str] = ..., name: _Optional[str] = ..., version: _Optional[str] = ...) -> None: ...

class ListRequest(_message.Message):
    __slots__ = ["request", "org", "cluster_id", "project", "artifact", "disable_identity_enrichment", "include_total_count"]
    REQUEST_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    CLUSTER_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    DISABLE_IDENTITY_ENRICHMENT_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    request: _list_pb2.ListRequest
    org: str
    cluster_id: _identifier_pb2.ClusterIdentifier
    project: _identifier_pb2.ProjectIdentifier
    artifact: ConsumedArtifactFilter
    disable_identity_enrichment: bool
    include_total_count: bool
    def __init__(self, request: _Optional[_Union[_list_pb2.ListRequest, _Mapping]] = ..., org: _Optional[str] = ..., cluster_id: _Optional[_Union[_identifier_pb2.ClusterIdentifier, _Mapping]] = ..., project: _Optional[_Union[_identifier_pb2.ProjectIdentifier, _Mapping]] = ..., artifact: _Optional[_Union[ConsumedArtifactFilter, _Mapping]] = ..., disable_identity_enrichment: bool = ..., include_total_count: bool = ...) -> None: ...

class ListResponse(_message.Message):
    __slots__ = ["apps", "token", "total_count"]
    APPS_FIELD_NUMBER: _ClassVar[int]
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    apps: _containers.RepeatedCompositeFieldContainer[_app_definition_pb2.App]
    token: str
    total_count: int
    def __init__(self, apps: _Optional[_Iterable[_Union[_app_definition_pb2.App, _Mapping]]] = ..., token: _Optional[str] = ..., total_count: _Optional[int] = ...) -> None: ...

class WatchRequest(_message.Message):
    __slots__ = ["org", "cluster_id", "project", "app_id"]
    ORG_FIELD_NUMBER: _ClassVar[int]
    CLUSTER_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    APP_ID_FIELD_NUMBER: _ClassVar[int]
    org: str
    cluster_id: _identifier_pb2.ClusterIdentifier
    project: _identifier_pb2.ProjectIdentifier
    app_id: _app_definition_pb2.Identifier
    def __init__(self, org: _Optional[str] = ..., cluster_id: _Optional[_Union[_identifier_pb2.ClusterIdentifier, _Mapping]] = ..., project: _Optional[_Union[_identifier_pb2.ProjectIdentifier, _Mapping]] = ..., app_id: _Optional[_Union[_app_definition_pb2.Identifier, _Mapping]] = ...) -> None: ...

class CreateEvent(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class UpdateEvent(_message.Message):
    __slots__ = ["updated_app", "old_app"]
    UPDATED_APP_FIELD_NUMBER: _ClassVar[int]
    OLD_APP_FIELD_NUMBER: _ClassVar[int]
    updated_app: _app_definition_pb2.App
    old_app: _app_definition_pb2.App
    def __init__(self, updated_app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ..., old_app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class DeleteEvent(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class WatchResponse(_message.Message):
    __slots__ = ["create_event", "update_event", "delete_event"]
    CREATE_EVENT_FIELD_NUMBER: _ClassVar[int]
    UPDATE_EVENT_FIELD_NUMBER: _ClassVar[int]
    DELETE_EVENT_FIELD_NUMBER: _ClassVar[int]
    create_event: CreateEvent
    update_event: UpdateEvent
    delete_event: DeleteEvent
    def __init__(self, create_event: _Optional[_Union[CreateEvent, _Mapping]] = ..., update_event: _Optional[_Union[UpdateEvent, _Mapping]] = ..., delete_event: _Optional[_Union[DeleteEvent, _Mapping]] = ...) -> None: ...

class UpdateStatusRequest(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class UpdateStatusResponse(_message.Message):
    __slots__ = ["app"]
    APP_FIELD_NUMBER: _ClassVar[int]
    app: _app_definition_pb2.App
    def __init__(self, app: _Optional[_Union[_app_definition_pb2.App, _Mapping]] = ...) -> None: ...

class LeaseRequest(_message.Message):
    __slots__ = ["id"]
    ID_FIELD_NUMBER: _ClassVar[int]
    id: _identifier_pb2.ClusterIdentifier
    def __init__(self, id: _Optional[_Union[_identifier_pb2.ClusterIdentifier, _Mapping]] = ...) -> None: ...

class LeaseResponse(_message.Message):
    __slots__ = ["apps"]
    APPS_FIELD_NUMBER: _ClassVar[int]
    apps: _containers.RepeatedCompositeFieldContainer[_app_definition_pb2.App]
    def __init__(self, apps: _Optional[_Iterable[_Union[_app_definition_pb2.App, _Mapping]]] = ...) -> None: ...
