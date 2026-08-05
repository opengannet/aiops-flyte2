package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"
	corev1 "k8s.io/api/core/v1"
	k8sresource "k8s.io/apimachinery/pkg/api/resource"

	appk8s "github.com/flyteorg/flyte/v2/app/internal/k8s"
	aionedownloader "github.com/flyteorg/flyte/v2/flyteplugins/aione/downloader"
	"github.com/flyteorg/flyte/v2/flytestdlib/utils"
	flyteapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/app"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/app/appconnect"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	flytecoreapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

// mockAppK8sClient is a testify mock for AppK8sClientInterface.
type mockAppK8sClient struct {
	mock.Mock
}

func (m *mockAppK8sClient) Deploy(ctx context.Context, app *flyteapp.App) error {
	return m.Called(ctx, app).Error(0)
}

func (m *mockAppK8sClient) DeployWithResources(ctx context.Context, app *flyteapp.App, resources appk8s.AppAuxResources) error {
	return m.Called(ctx, app, resources).Error(0)
}

func (m *mockAppK8sClient) Stop(ctx context.Context, appID *flyteapp.Identifier) error {
	return m.Called(ctx, appID).Error(0)
}

func (m *mockAppK8sClient) Delete(ctx context.Context, appID *flyteapp.Identifier) error {
	return m.Called(ctx, appID).Error(0)
}

func (m *mockAppK8sClient) GetApp(ctx context.Context, appID *flyteapp.Identifier) (*flyteapp.App, error) {
	args := m.Called(ctx, appID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*flyteapp.App), args.Error(1)
}

func (m *mockAppK8sClient) List(ctx context.Context, project, domain string, limit uint32, token string) ([]*flyteapp.App, string, error) {
	args := m.Called(ctx, project, domain, limit, token)
	if args.Get(0) == nil {
		return nil, "", args.Error(2)
	}
	return args.Get(0).([]*flyteapp.App), args.String(1), args.Error(2)
}

func (m *mockAppK8sClient) GetReplicas(ctx context.Context, appID *flyteapp.Identifier) ([]*flyteapp.Replica, error) {
	args := m.Called(ctx, appID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*flyteapp.Replica), args.Error(1)
}

func (m *mockAppK8sClient) DeleteReplica(ctx context.Context, replicaID *flyteapp.ReplicaIdentifier) error {
	return m.Called(ctx, replicaID).Error(0)
}

func (m *mockAppK8sClient) StartWatching(ctx context.Context) error {
	return m.Called(ctx).Error(0)
}

func (m *mockAppK8sClient) StopWatching() {
	m.Called()
}

func (m *mockAppK8sClient) Subscribe(appName string) chan *flyteapp.WatchResponse {
	args := m.Called(appName)
	return args.Get(0).(chan *flyteapp.WatchResponse)
}

func (m *mockAppK8sClient) Unsubscribe(appName string, ch chan *flyteapp.WatchResponse) {
	m.Called(appName, ch)
}

func (m *mockAppK8sClient) PublicIngress(id *flyteapp.Identifier) *flyteapp.Ingress {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil
	}
	return args.Get(0).(*flyteapp.Ingress)
}

// --- helpers ---

func testAppID() *flyteapp.Identifier {
	return &flyteapp.Identifier{Project: "proj", Domain: "dev", Name: "myapp"}
}

func quantityString(q k8sresource.Quantity) string { return q.String() }

func testApp() *flyteapp.App {
	return &flyteapp.App{
		Metadata: &flyteapp.Meta{Id: testAppID()},
		Spec: &flyteapp.Spec{
			AppPayload: &flyteapp.Spec_Container{
				Container: &flytecoreapp.Container{Image: "nginx:latest"},
			},
		},
	}
}

func testAppWithStatus(phase flyteapp.Status_DeploymentStatus) *flyteapp.App {
	return &flyteapp.App{
		Metadata: &flyteapp.Meta{Id: testAppID()},
		Status: &flyteapp.Status{
			Conditions: []*flyteapp.Condition{
				{DeploymentStatus: phase},
			},
		},
	}
}

func newTestClient(t *testing.T, k8s *mockAppK8sClient) appconnect.AppServiceClient {
	svc := NewInternalAppService(k8s)
	path, handler := appconnect.NewAppServiceHandler(svc)
	mux := http.NewServeMux()
	mux.Handle("/internal"+path, http.StripPrefix("/internal", handler))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return appconnect.NewAppServiceClient(http.DefaultClient, server.URL+"/internal")
}

// --- Create ---

func TestCreate_Success(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	app := testApp()
	ingress := &flyteapp.Ingress{PublicUrl: "https://myapp-3dcbfc92-flyte.example.com"}
	k8s.On("Deploy", mock.Anything, app).Return(nil)
	k8s.On("PublicIngress", app.Metadata.Id).Return(ingress)

	resp, err := svc.Create(context.Background(), connect.NewRequest(&flyteapp.CreateRequest{App: app}))
	require.NoError(t, err)
	// Conditions are written by Deployment watch events, not by Create directly.
	assert.Empty(t, resp.Msg.App.Status.Conditions)
	assert.Equal(t, ingress.PublicUrl, resp.Msg.App.Status.Ingress.PublicUrl)
	k8s.AssertExpectations(t)
}

func TestCreate_MissingID(t *testing.T) {
	svc := NewInternalAppService(&mockAppK8sClient{})

	_, err := svc.Create(context.Background(), connect.NewRequest(&flyteapp.CreateRequest{
		App: &flyteapp.App{Spec: testApp().Spec},
	}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
}

func TestCreate_MissingSpec(t *testing.T) {
	svc := NewInternalAppService(&mockAppK8sClient{})

	_, err := svc.Create(context.Background(), connect.NewRequest(&flyteapp.CreateRequest{
		App: &flyteapp.App{Metadata: &flyteapp.Meta{Id: testAppID()}},
	}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
}

func TestCreate_MissingPayload(t *testing.T) {
	svc := NewInternalAppService(&mockAppK8sClient{})

	_, err := svc.Create(context.Background(), connect.NewRequest(&flyteapp.CreateRequest{
		App: &flyteapp.App{
			Metadata: &flyteapp.Meta{Id: testAppID()},
			Spec:     &flyteapp.Spec{},
		},
	}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
}

func TestCreate_IngressWithPort(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	app := testApp()
	ingress := &flyteapp.Ingress{PublicUrl: "https://myapp-3dcbfc92-flyte.example.com:30081"}
	k8s.On("Deploy", mock.Anything, app).Return(nil)
	k8s.On("PublicIngress", app.Metadata.Id).Return(ingress)

	resp, err := svc.Create(context.Background(), connect.NewRequest(&flyteapp.CreateRequest{App: app}))
	require.NoError(t, err)
	assert.Equal(t, ingress.PublicUrl, resp.Msg.App.Status.Ingress.PublicUrl)
	k8s.AssertExpectations(t)
}

func TestCreate_NoBaseDomain_NoIngress(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	app := testApp()
	k8s.On("Deploy", mock.Anything, app).Return(nil)
	k8s.On("PublicIngress", app.Metadata.Id).Return((*flyteapp.Ingress)(nil))

	resp, err := svc.Create(context.Background(), connect.NewRequest(&flyteapp.CreateRequest{App: app}))
	require.NoError(t, err)
	assert.Nil(t, resp.Msg.App.Status.Ingress)
	k8s.AssertExpectations(t)
}

func TestCreateModelApp_BuildsSanitizedVLLMPod(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	var deployedApp *flyteapp.App
	var aux appk8s.AppAuxResources
	ingress := &flyteapp.Ingress{PublicUrl: "http://qwen-local-proj-dev.example.com"}
	k8s.On("DeployWithResources", mock.Anything, mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
		deployedApp = args.Get(1).(*flyteapp.App)
		aux = args.Get(2).(appk8s.AppAuxResources)
	}).Return(nil)
	k8s.On("PublicIngress", mock.MatchedBy(func(id *flyteapp.Identifier) bool {
		return id.GetProject() == "proj" && id.GetDomain() == "dev" && id.GetName() == "qwen-local"
	})).Return(ingress)

	resp, err := svc.CreateModelApp(context.Background(), connect.NewRequest(&flyteapp.CreateModelAppRequest{
		Model: &flyteapp.ModelAppInput{
			Org:     "flyte",
			Project: "proj",
			Domain:  "dev",
			Name:    "Qwen Local",
			Id:      "qwen-local",
			Code:    "qwen-local",
			Image:   "vllm",
			Param:   "--served-model-name\nqwen-local",
			Codes: []*flyteapp.ModelCodeSource{{
				Id:     "https://git.example.com/team/qwen-local.git",
				Branch: "main",
				Token:  "secret-token",
			}},
			ResourceDefinition: &flyteapp.ModelResourceDefinition{
				Cpu:    "4",
				Memory: "16Gi",
				Gpu:    1,
				GpuKey: "example.com/gpu",
			},
		},
	}))
	require.NoError(t, err)
	require.NotNil(t, deployedApp)
	assert.Equal(t, "qwen-local", resp.Msg.App.Metadata.Id.Name)
	assert.Equal(t, ingress.PublicUrl, resp.Msg.App.Status.Ingress.PublicUrl)

	specJSON, err := protojson.Marshal(deployedApp.Spec)
	require.NoError(t, err)
	assert.NotContains(t, string(specJSON), "secret-token")
	assert.Contains(t, string(specJSON), `"type":"VLLM"`)
	assert.Contains(t, string(specJSON), "qwen-local")

	require.Len(t, aux.Secrets, 1)
	require.Len(t, aux.PersistentVolumeClaims, 1)
	secretData := aux.Secrets[0].Data[aionedownloader.SecretKey]
	rawSecret, err := base64.StdEncoding.DecodeString(string(secretData))
	require.NoError(t, err)
	var secretParams map[string]interface{}
	require.NoError(t, json.Unmarshal(rawSecret, &secretParams))
	assert.Contains(t, string(rawSecret), "secret-token")
	assert.Contains(t, string(rawSecret), "/models/qwen-local")

	var podSpec corev1.PodSpec
	require.NoError(t, utils.UnmarshalStructToObj(deployedApp.Spec.GetPod().GetPodSpec(), &podSpec))
	require.Len(t, podSpec.InitContainers, 1)
	require.Len(t, podSpec.Containers, 1)
	main := podSpec.Containers[0]
	assert.Equal(t, "vllm", main.Name)
	assert.Equal(t, "docker.ops.fzyun.io:5000/vllm/vllm-openai:latest", main.Image)
	assert.Contains(t, main.Args, "--host")
	assert.Contains(t, main.Args, "0.0.0.0")
	assert.Contains(t, main.Args, "--port")
	assert.Contains(t, main.Args, "8000")
	assert.Contains(t, main.Args, "--model")
	assert.Contains(t, main.Args, "/models/qwen-local")
	assert.Equal(t, int32(8000), main.Ports[0].ContainerPort)
	assert.Equal(t, "/v1/models", main.ReadinessProbe.HTTPGet.Path)
	assert.Equal(t, "/v1/models", main.StartupProbe.HTTPGet.Path)
	assert.Equal(t, "1", quantityString(main.Resources.Requests[corev1.ResourceName("example.com/gpu")]))
	assert.Equal(t, "1", quantityString(main.Resources.Limits[corev1.ResourceName("example.com/gpu")]))
	assert.Equal(t, aux.Secrets[0].Name, podSpec.InitContainers[0].Env[0].ValueFrom.SecretKeyRef.Name)
	assert.Equal(t, aux.PersistentVolumeClaims[0].Name, podSpec.Volumes[0].PersistentVolumeClaim.ClaimName)
	assert.Equal(t, "/models", main.VolumeMounts[0].MountPath)
	assert.Equal(t, "/root/.cache/huggingface", main.VolumeMounts[1].MountPath)
	k8s.AssertExpectations(t)
}

// --- Get ---

func TestGet_Success(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	appID := testAppID()
	k8s.On("GetApp", mock.Anything, appID).Return(testAppWithStatus(flyteapp.Status_DEPLOYMENT_STATUS_ACTIVE), nil)

	resp, err := svc.Get(context.Background(), connect.NewRequest(&flyteapp.GetRequest{
		Identifier: &flyteapp.GetRequest_AppId{AppId: appID},
	}))
	require.NoError(t, err)
	assert.Equal(t, flyteapp.Status_DEPLOYMENT_STATUS_ACTIVE, resp.Msg.App.Status.Conditions[0].DeploymentStatus)
	k8s.AssertExpectations(t)
}

func TestGet_MissingAppID(t *testing.T) {
	svc := NewInternalAppService(&mockAppK8sClient{})

	_, err := svc.Get(context.Background(), connect.NewRequest(&flyteapp.GetRequest{}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
}

// --- Update ---

func TestUpdate_Deploy(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	app := testApp()
	k8s.On("Deploy", mock.Anything, app).Return(nil)
	k8s.On("GetApp", mock.Anything, app.Metadata.Id).Return(testAppWithStatus(flyteapp.Status_DEPLOYMENT_STATUS_DEPLOYING), nil)

	resp, err := svc.Update(context.Background(), connect.NewRequest(&flyteapp.UpdateRequest{App: app}))
	require.NoError(t, err)
	assert.Equal(t, flyteapp.Status_DEPLOYMENT_STATUS_DEPLOYING, resp.Msg.App.Status.Conditions[0].DeploymentStatus)
	k8s.AssertExpectations(t)
}

func TestUpdate_Stop(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	app := testApp()
	app.Spec.DesiredState = flyteapp.Spec_DESIRED_STATE_STOPPED
	k8s.On("Stop", mock.Anything, app.Metadata.Id).Return(nil)
	k8s.On("GetApp", mock.Anything, app.Metadata.Id).Return(testAppWithStatus(flyteapp.Status_DEPLOYMENT_STATUS_STOPPED), nil)

	resp, err := svc.Update(context.Background(), connect.NewRequest(&flyteapp.UpdateRequest{App: app}))
	require.NoError(t, err)
	assert.Equal(t, flyteapp.Status_DEPLOYMENT_STATUS_STOPPED, resp.Msg.App.Status.Conditions[0].DeploymentStatus)
	k8s.AssertExpectations(t)
}

func TestUpdate_MissingID(t *testing.T) {
	svc := NewInternalAppService(&mockAppK8sClient{})

	_, err := svc.Update(context.Background(), connect.NewRequest(&flyteapp.UpdateRequest{
		App: &flyteapp.App{},
	}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
}

// --- Delete ---

func TestDelete_Success(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	appID := testAppID()
	k8s.On("Delete", mock.Anything, appID).Return(nil)

	_, err := svc.Delete(context.Background(), connect.NewRequest(&flyteapp.DeleteRequest{AppId: appID}))
	require.NoError(t, err)
	k8s.AssertExpectations(t)
}

func TestDelete_MissingID(t *testing.T) {
	svc := NewInternalAppService(&mockAppK8sClient{})

	_, err := svc.Delete(context.Background(), connect.NewRequest(&flyteapp.DeleteRequest{}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
}

// --- List ---

func TestList_ByProject(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	apps := []*flyteapp.App{testApp()}
	k8s.On("List", mock.Anything, "proj", "dev", uint32(10), "tok").Return(apps, "nexttok", nil)

	resp, err := svc.List(context.Background(), connect.NewRequest(&flyteapp.ListRequest{
		FilterBy: &flyteapp.ListRequest_Project{
			Project: &common.ProjectIdentifier{Name: "proj", Domain: "dev"},
		},
		Request: &common.ListRequest{Limit: 10, Token: "tok"},
	}))
	require.NoError(t, err)
	assert.Len(t, resp.Msg.Apps, 1)
	assert.Equal(t, "nexttok", resp.Msg.Token)
	k8s.AssertExpectations(t)
}

func TestList_NoFilter(t *testing.T) {
	k8s := &mockAppK8sClient{}
	svc := NewInternalAppService(k8s)

	k8s.On("List", mock.Anything, "", "", uint32(0), "").Return([]*flyteapp.App{}, "", nil)

	resp, err := svc.List(context.Background(), connect.NewRequest(&flyteapp.ListRequest{}))
	require.NoError(t, err)
	assert.Empty(t, resp.Msg.Apps)
	k8s.AssertExpectations(t)
}

// --- Watch ---

func TestWatch_AppIDTarget(t *testing.T) {
	k8s := &mockAppK8sClient{}

	ch := make(chan *flyteapp.WatchResponse)
	close(ch)

	k8s.On("List", mock.Anything, "proj", "dev", uint32(0), "").Return([]*flyteapp.App{}, "", nil)
	k8s.On("Subscribe", "myapp").Return(ch)
	k8s.On("Unsubscribe", "myapp", ch).Return()

	client := newTestClient(t, k8s)
	stream, err := client.Watch(context.Background(), connect.NewRequest(&flyteapp.WatchRequest{
		Target: &flyteapp.WatchRequest_AppId{AppId: testAppID()},
	}))
	require.NoError(t, err)

	// No snapshot apps, channel closed — stream ends immediately.
	assert.False(t, stream.Receive())
	k8s.AssertExpectations(t)
}
