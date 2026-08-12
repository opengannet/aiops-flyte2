from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CloudStorageStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = []
    CLOUD_STORAGE_STATUS_UNSPECIFIED: _ClassVar[CloudStorageStatus]
    CLOUD_STORAGE_STATUS_PENDING: _ClassVar[CloudStorageStatus]
    CLOUD_STORAGE_STATUS_MATERIALIZED: _ClassVar[CloudStorageStatus]
CLOUD_STORAGE_STATUS_UNSPECIFIED: CloudStorageStatus
CLOUD_STORAGE_STATUS_PENDING: CloudStorageStatus
CLOUD_STORAGE_STATUS_MATERIALIZED: CloudStorageStatus

class CloudStorageIdentifier(_message.Message):
    __slots__ = ["org", "project", "domain", "id"]
    ORG_FIELD_NUMBER: _ClassVar[int]
    PROJECT_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    org: str
    project: str
    domain: str
    id: str
    def __init__(self, org: _Optional[str] = ..., project: _Optional[str] = ..., domain: _Optional[str] = ..., id: _Optional[str] = ...) -> None: ...

class CloudStorage(_message.Message):
    __slots__ = ["id", "name", "description", "size_gb", "storage_class_name", "target_namespace", "pvc_name", "creator", "status", "created_at", "updated_at", "materialized_at", "materializations"]
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    SIZE_GB_FIELD_NUMBER: _ClassVar[int]
    STORAGE_CLASS_NAME_FIELD_NUMBER: _ClassVar[int]
    TARGET_NAMESPACE_FIELD_NUMBER: _ClassVar[int]
    PVC_NAME_FIELD_NUMBER: _ClassVar[int]
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    MATERIALIZED_AT_FIELD_NUMBER: _ClassVar[int]
    MATERIALIZATIONS_FIELD_NUMBER: _ClassVar[int]
    id: CloudStorageIdentifier
    name: str
    description: str
    size_gb: int
    storage_class_name: str
    target_namespace: str
    pvc_name: str
    creator: str
    status: CloudStorageStatus
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    materialized_at: _timestamp_pb2.Timestamp
    materializations: _containers.RepeatedCompositeFieldContainer[CloudStorageMaterialization]
    def __init__(self, id: _Optional[_Union[CloudStorageIdentifier, _Mapping]] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., size_gb: _Optional[int] = ..., storage_class_name: _Optional[str] = ..., target_namespace: _Optional[str] = ..., pvc_name: _Optional[str] = ..., creator: _Optional[str] = ..., status: _Optional[_Union[CloudStorageStatus, str]] = ..., created_at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., materialized_at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., materializations: _Optional[_Iterable[_Union[CloudStorageMaterialization, _Mapping]]] = ...) -> None: ...

class CloudStorageMount(_message.Message):
    __slots__ = ["cloud_storage_id", "mount_path"]
    CLOUD_STORAGE_ID_FIELD_NUMBER: _ClassVar[int]
    MOUNT_PATH_FIELD_NUMBER: _ClassVar[int]
    cloud_storage_id: str
    mount_path: str
    def __init__(self, cloud_storage_id: _Optional[str] = ..., mount_path: _Optional[str] = ...) -> None: ...

class CloudStorageMaterialization(_message.Message):
    __slots__ = ["target_namespace", "pvc_name", "materialized_at"]
    TARGET_NAMESPACE_FIELD_NUMBER: _ClassVar[int]
    PVC_NAME_FIELD_NUMBER: _ClassVar[int]
    MATERIALIZED_AT_FIELD_NUMBER: _ClassVar[int]
    target_namespace: str
    pvc_name: str
    materialized_at: _timestamp_pb2.Timestamp
    def __init__(self, target_namespace: _Optional[str] = ..., pvc_name: _Optional[str] = ..., materialized_at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
