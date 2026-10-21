// Chalkfall physics bridge: a small handle-based C API over Box2D v3 for WebAssembly.
// JavaScript passes plain numbers; bulk data goes through one shared scratch buffer.
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <emscripten/emscripten.h>
#include "box2d/box2d.h"

#define API EMSCRIPTEN_KEEPALIVE
#define MAX_BODIES 4096
#define MAX_SHAPES 8192
#define MAX_JOINTS 4096
#define SCRATCH 65536

static b2WorldId g_world;
static int g_hasWorld = 0;
static b2BodyId g_bodies[MAX_BODIES];
static b2ShapeId g_shapes[MAX_SHAPES];
static b2JointId g_joints[MAX_JOINTS];
static int g_bodyTop = 0, g_shapeTop = 0, g_jointTop = 0;
static int g_bodyFree[MAX_BODIES], g_shapeFree[MAX_SHAPES], g_jointFree[MAX_JOINTS];
static int g_bodyFreeN = 0, g_shapeFreeN = 0, g_jointFreeN = 0;
static uint8_t g_bodyLive[MAX_BODIES], g_shapeLive[MAX_SHAPES], g_jointLive[MAX_JOINTS];
static float g_scratch[SCRATCH];

API float* scratch(void) { return g_scratch; }

static int allocHandle(int* top, int* freeList, int* freeN, int max) {
	if (*freeN > 0) return freeList[--(*freeN)];
	if (*top + 1 >= max) return 0;
	return ++(*top);
}

static int shapeHandle(b2ShapeId id) { return (int)(intptr_t)b2Shape_GetUserData(id); }
static int bodyHandle(b2BodyId id) { return (int)(intptr_t)b2Body_GetUserData(id); }

// ------------------------------------------------------------------ world

API int world_create(float gx, float gy, float contactHertz, float dampingRatio, float pushSpeed, float hitThreshold, float maxSpeed) {
	if (g_hasWorld) { b2DestroyWorld(g_world); }
	b2WorldDef def = b2DefaultWorldDef();
	def.gravity = (b2Vec2){gx, gy};
	if (contactHertz > 0) def.contactHertz = contactHertz;
	if (dampingRatio > 0) def.contactDampingRatio = dampingRatio;
	if (pushSpeed > 0) def.contactSpeed = pushSpeed;
	if (hitThreshold > 0) def.hitEventThreshold = hitThreshold;
	if (maxSpeed > 0) def.maximumLinearSpeed = maxSpeed;
	def.enableSleep = true;
	def.enableContinuous = true;
	def.workerCount = 1;
	g_world = b2CreateWorld(&def);
	g_hasWorld = 1;
	g_bodyTop = g_shapeTop = g_jointTop = 0;
	g_bodyFreeN = g_shapeFreeN = g_jointFreeN = 0;
	memset(g_bodyLive, 0, sizeof g_bodyLive);
	memset(g_shapeLive, 0, sizeof g_shapeLive);
	memset(g_jointLive, 0, sizeof g_jointLive);
	return 1;
}

API void world_destroy(void) {
	if (g_hasWorld) b2DestroyWorld(g_world);
	g_hasWorld = 0;
}

API void world_step(float dt, int subSteps) { b2World_Step(g_world, dt, subSteps); }
API void world_set_gravity(float gx, float gy) { b2World_SetGravity(g_world, (b2Vec2){gx, gy}); }

// Radial impulse on every shape in range (positive pushes away, negative pulls in).
API void world_explode(float x, float y, float radius, float falloff, float impulsePerLength) {
	b2ExplosionDef d = b2DefaultExplosionDef();
	d.position = (b2Vec2){x, y};
	d.radius = radius;
	d.falloff = falloff;
	d.impulsePerLength = impulsePerLength;
	b2World_Explode(g_world, &d);
}

typedef struct { int count, max; int* out; } QueryCtx;
static bool overlapCb(b2ShapeId id, void* ctx) {
	QueryCtx* q = (QueryCtx*)ctx;
	if (q->count >= q->max) return false;
	q->out[q->count++] = shapeHandle(id);
	return true;
}

// Shapes whose bounding boxes overlap the AABB -> scratch (int32), returns the count.
API int world_query_aabb(float x0, float y0, float x1, float y1, int max) {
	if (max > SCRATCH) max = SCRATCH;
	QueryCtx q = {0, max, (int*)g_scratch};
	b2AABB box = {{x0, y0}, {x1, y1}};
	b2World_OverlapAABB(g_world, b2Vec2_zero, box, b2DefaultQueryFilter(), overlapCb, &q);
	return q.count;
}

// Closest ray hit: returns the shape handle (0 = none); scratch = [x, y, nx, ny, fraction].
API int world_raycast(float x, float y, float dx, float dy) {
	b2RayResult r = b2World_CastRayClosest(g_world, (b2Vec2){x, y}, (b2Vec2){dx, dy}, b2DefaultQueryFilter());
	if (!r.hit) return 0;
	g_scratch[0] = r.point.x; g_scratch[1] = r.point.y;
	g_scratch[2] = r.normal.x; g_scratch[3] = r.normal.y; g_scratch[4] = r.fraction;
	return shapeHandle(r.shapeId);
}

// Contact begin events -> scratch [a, b] (int32 shape handles); returns count.
API int world_begin_events(void) {
	b2ContactEvents ev = b2World_GetContactEvents(g_world);
	int* o = (int*)g_scratch; int n = 0;
	for (int i = 0; i < ev.beginCount && n * 2 + 2 < SCRATCH; i++) {
		b2ContactBeginTouchEvent* e = ev.beginEvents + i;
		if (!b2Shape_IsValid(e->shapeIdA) || !b2Shape_IsValid(e->shapeIdB)) continue;
		o[n * 2] = shapeHandle(e->shapeIdA); o[n * 2 + 1] = shapeHandle(e->shapeIdB); n++;
	}
	return n;
}

// Hit events -> scratch [a, b, x, y, speed] (a, b as int32); returns count.
API int world_hit_events(void) {
	b2ContactEvents ev = b2World_GetContactEvents(g_world);
	int n = 0;
	for (int i = 0; i < ev.hitCount && n * 5 + 5 < SCRATCH; i++) {
		b2ContactHitEvent* e = ev.hitEvents + i;
		if (!b2Shape_IsValid(e->shapeIdA) || !b2Shape_IsValid(e->shapeIdB)) continue;
		float* o = g_scratch + n * 5;
		((int*)o)[0] = shapeHandle(e->shapeIdA); ((int*)o)[1] = shapeHandle(e->shapeIdB);
		o[2] = e->point.x; o[3] = e->point.y; o[4] = e->approachSpeed;
		n++;
	}
	return n;
}

// Sensor begin events -> scratch [sensor, visitor]; returns count.
API int world_sensor_events(void) {
	b2SensorEvents ev = b2World_GetSensorEvents(g_world);
	int* o = (int*)g_scratch; int n = 0;
	for (int i = 0; i < ev.beginCount && n * 2 + 2 < SCRATCH; i++) {
		b2SensorBeginTouchEvent* e = ev.beginEvents + i;
		if (!b2Shape_IsValid(e->sensorShapeId) || !b2Shape_IsValid(e->visitorShapeId)) continue;
		o[n * 2] = shapeHandle(e->sensorShapeId); o[n * 2 + 1] = shapeHandle(e->visitorShapeId); n++;
	}
	return n;
}

// Joints whose force/torque passed their thresholds -> scratch [joint]; returns count.
API int world_joint_events(void) {
	b2JointEvents ev = b2World_GetJointEvents(g_world);
	int* o = (int*)g_scratch; int n = 0;
	for (int i = 0; i < ev.count && n < SCRATCH; i++) {
		b2JointEvent* e = ev.jointEvents + i;
		if (!b2Joint_IsValid(e->jointId)) continue;
		o[n++] = (int)(intptr_t)e->userData;
	}
	return n;
}

// All live bodies -> scratch, 8 floats each: [handle, x, y, angle, vx, vy, w, flags]
// flags: 1 awake, 2 dynamic. Returns the count.
API int world_read_bodies(void) {
	int n = 0;
	for (int h = 1; h <= g_bodyTop && (n + 1) * 8 <= SCRATCH; h++) {
		if (!g_bodyLive[h]) continue;
		b2BodyId id = g_bodies[h];
		b2Transform t = b2Body_GetTransform(id);
		b2Vec2 v = b2Body_GetLinearVelocity(id);
		float* o = g_scratch + n * 8;
		((int*)o)[0] = h;
		o[1] = t.p.x; o[2] = t.p.y; o[3] = b2Rot_GetAngle(t.q);
		o[4] = v.x; o[5] = v.y; o[6] = b2Body_GetAngularVelocity(id);
		((int*)o)[7] = (b2Body_IsAwake(id) ? 1 : 0) | (b2Body_GetType(id) == b2_dynamicBody ? 2 : 0);
		n++;
	}
	return n;
}

// ------------------------------------------------------------------ bodies

// type: 0 static, 1 kinematic, 2 dynamic
API int body_create(int type, float x, float y, float angle, float linDamp, float angDamp, float gravityScale, int bullet, int fixedRotation, int awake) {
	int h = allocHandle(&g_bodyTop, g_bodyFree, &g_bodyFreeN, MAX_BODIES);
	if (!h) return 0;
	b2BodyDef d = b2DefaultBodyDef();
	d.type = (b2BodyType)type;
	d.position = (b2Vec2){x, y};
	d.rotation = b2MakeRot(angle);
	d.linearDamping = linDamp;
	d.angularDamping = angDamp;
	d.gravityScale = gravityScale;
	d.isBullet = bullet != 0;
	d.motionLocks.angularZ = fixedRotation != 0;
	d.isAwake = awake != 0;
	d.userData = (void*)(intptr_t)h;
	g_bodies[h] = b2CreateBody(g_world, &d);
	g_bodyLive[h] = 1;
	return h;
}

API void body_destroy(int h) {
	if (h <= 0 || !g_bodyLive[h]) return;
	// shapes on the body die with it: release their handles
	b2ShapeId ids[64];
	int n = b2Body_GetShapes(g_bodies[h], ids, 64);
	for (int i = 0; i < n; i++) { int sh = shapeHandle(ids[i]); if (sh > 0) { g_shapeLive[sh] = 0; g_shapeFree[g_shapeFreeN++] = sh; } }
	b2JointId js[64];
	int nj = b2Body_GetJoints(g_bodies[h], js, 64);
	for (int i = 0; i < nj; i++) { int jh = (int)(intptr_t)b2Joint_GetUserData(js[i]); if (jh > 0) { g_jointLive[jh] = 0; g_jointFree[g_jointFreeN++] = jh; } }
	b2DestroyBody(g_bodies[h]);
	g_bodyLive[h] = 0;
	g_bodyFree[g_bodyFreeN++] = h;
}

API void body_set_type(int h, int type) { b2Body_SetType(g_bodies[h], (b2BodyType)type); }

API void body_set_transform(int h, float x, float y, float angle) {
	b2Body_SetTransform(g_bodies[h], (b2Vec2){x, y}, b2MakeRot(angle));
}

// scratch = [x, y, angle, vx, vy, w, cx, cy, mass, inertia, awake]
API void body_get(int h) {
	b2BodyId id = g_bodies[h];
	b2Transform t = b2Body_GetTransform(id);
	b2Vec2 v = b2Body_GetLinearVelocity(id);
	b2Vec2 c = b2Body_GetWorldCenter(id);
	float* o = g_scratch;
	o[0] = t.p.x; o[1] = t.p.y; o[2] = b2Rot_GetAngle(t.q);
	o[3] = v.x; o[4] = v.y; o[5] = b2Body_GetAngularVelocity(id);
	o[6] = c.x; o[7] = c.y;
	o[8] = b2Body_GetMass(id); o[9] = b2Body_GetRotationalInertia(id);
	o[10] = b2Body_IsAwake(id) ? 1.0f : 0.0f;
}

API void body_set_velocity(int h, float vx, float vy, float w) {
	b2Body_SetLinearVelocity(g_bodies[h], (b2Vec2){vx, vy});
	b2Body_SetAngularVelocity(g_bodies[h], w);
}

API void body_impulse(int h, float ix, float iy, float px, float py) {
	b2Body_ApplyLinearImpulse(g_bodies[h], (b2Vec2){ix, iy}, (b2Vec2){px, py}, true);
}

API void body_impulse_center(int h, float ix, float iy) {
	b2Body_ApplyLinearImpulseToCenter(g_bodies[h], (b2Vec2){ix, iy}, true);
}

API void body_angular_impulse(int h, float imp) { b2Body_ApplyAngularImpulse(g_bodies[h], imp, true); }
API void body_force(int h, float fx, float fy) { b2Body_ApplyForceToCenter(g_bodies[h], (b2Vec2){fx, fy}, true); }
API void body_set_awake(int h, int awake) { b2Body_SetAwake(g_bodies[h], awake != 0); }
API void body_update_mass(int h) { b2Body_UpdateMassFromShapes(g_bodies[h]); }
API void body_set_bullet(int h, int on) { b2Body_SetBullet(g_bodies[h], on != 0); }
API void body_set_gravity_scale(int h, float s) { b2Body_SetGravityScale(g_bodies[h], s); }
API void body_set_damping(int h, float lin, float ang) {
	b2Body_SetLinearDamping(g_bodies[h], lin);
	b2Body_SetAngularDamping(g_bodies[h], ang);
}

// ------------------------------------------------------------------ shapes

static b2ShapeDef shapeDef(float density, float friction, float restitution, int cat, int mask, int group, int flags) {
	b2ShapeDef d = b2DefaultShapeDef();
	d.density = density;
	d.material.friction = friction;
	d.material.restitution = restitution;
	d.filter.categoryBits = (uint64_t)(uint32_t)cat;
	d.filter.maskBits = (uint64_t)(uint32_t)mask;
	d.filter.groupIndex = group;
	d.isSensor = (flags & 1) != 0;
	d.enableSensorEvents = (flags & 2) != 0;
	d.enableContactEvents = (flags & 4) != 0;
	d.enableHitEvents = (flags & 8) != 0;
	d.updateBodyMass = (flags & 16) == 0;
	return d;
}

// Convex polygon from n local points in scratch (x, y pairs); radius rounds the corners.
// flags: 1 sensor, 2 sensor events, 4 contact events, 8 hit events, 16 skip mass update.
API int shape_polygon(int bh, int n, float radius, float density, float friction, float restitution, int cat, int mask, int group, int flags) {
	if (n < 3 || n > B2_MAX_POLYGON_VERTICES) return 0;
	b2Vec2 pts[B2_MAX_POLYGON_VERTICES];
	for (int i = 0; i < n; i++) pts[i] = (b2Vec2){g_scratch[i * 2], g_scratch[i * 2 + 1]};
	b2Hull hull = b2ComputeHull(pts, n);
	if (hull.count == 0) return 0;
	b2Polygon poly = b2MakePolygon(&hull, radius);
	int h = allocHandle(&g_shapeTop, g_shapeFree, &g_shapeFreeN, MAX_SHAPES);
	if (!h) return 0;
	b2ShapeDef d = shapeDef(density, friction, restitution, cat, mask, group, flags);
	d.userData = (void*)(intptr_t)h;
	g_shapes[h] = b2CreatePolygonShape(g_bodies[bh], &d, &poly);
	g_shapeLive[h] = 1;
	return h;
}

API int shape_circle(int bh, float x, float y, float r, float density, float friction, float restitution, int cat, int mask, int group, int flags) {
	int h = allocHandle(&g_shapeTop, g_shapeFree, &g_shapeFreeN, MAX_SHAPES);
	if (!h) return 0;
	b2ShapeDef d = shapeDef(density, friction, restitution, cat, mask, group, flags);
	d.userData = (void*)(intptr_t)h;
	b2Circle c = {{x, y}, r};
	g_shapes[h] = b2CreateCircleShape(g_bodies[bh], &d, &c);
	g_shapeLive[h] = 1;
	return h;
}

API void shape_destroy(int h, int updateMass) {
	if (h <= 0 || !g_shapeLive[h]) return;
	b2DestroyShape(g_shapes[h], updateMass != 0);
	g_shapeLive[h] = 0;
	g_shapeFree[g_shapeFreeN++] = h;
}

API int shape_body(int h) { return bodyHandle(b2Shape_GetBody(g_shapes[h])); }
API int shape_live(int h) { return h > 0 && h < MAX_SHAPES && g_shapeLive[h] && b2Shape_IsValid(g_shapes[h]); }
API int body_live(int h) { return h > 0 && h < MAX_BODIES && g_bodyLive[h] && b2Body_IsValid(g_bodies[h]); }

API void shape_aabb(int h) {
	b2AABB b = b2Shape_GetBounds(g_shapes[h]);
	g_scratch[0] = b.lowerBound.x; g_scratch[1] = b.lowerBound.y;
	g_scratch[2] = b.upperBound.x; g_scratch[3] = b.upperBound.y;
}

API int shape_test_point(int h, float x, float y) { return b2Shape_TestPoint(g_shapes[h], (b2Vec2){x, y}) ? 1 : 0; }

API void shape_set_filter(int h, int cat, int mask, int group) {
	b2Filter f = b2DefaultFilter();
	f.categoryBits = (uint64_t)(uint32_t)cat;
	f.maskBits = (uint64_t)(uint32_t)mask;
	f.groupIndex = group;
	b2Shape_SetFilter(g_shapes[h], f);
}

API void shape_set_friction(int h, float f) { b2Shape_SetFriction(g_shapes[h], f); }

// ------------------------------------------------------------------ joints

// Weld at a world anchor keeping the current relative pose. Thresholds (<= 0: none) raise joint events.
API int joint_weld(int ha, int hb, float ax, float ay, float linearHertz, float angularHertz, float damping, float forceThreshold, float torqueThreshold) {
	int h = allocHandle(&g_jointTop, g_jointFree, &g_jointFreeN, MAX_JOINTS);
	if (!h) return 0;
	b2BodyId a = g_bodies[ha], b = g_bodies[hb];
	b2Transform ta = b2Body_GetTransform(a), tb = b2Body_GetTransform(b);
	b2WeldJointDef d = b2DefaultWeldJointDef();
	d.base.bodyIdA = a; d.base.bodyIdB = b;
	b2Vec2 anchor = {ax, ay};
	d.base.localFrameA.p = b2InvRotateVector(ta.q, b2Sub(anchor, ta.p));
	d.base.localFrameA.q = b2InvMulRot(ta.q, b2Rot_identity);
	d.base.localFrameB.p = b2InvRotateVector(tb.q, b2Sub(anchor, tb.p));
	d.base.localFrameB.q = b2InvMulRot(tb.q, b2Rot_identity);
	d.base.forceThreshold = forceThreshold > 0 ? forceThreshold : FLT_MAX;
	d.base.torqueThreshold = torqueThreshold > 0 ? torqueThreshold : FLT_MAX;
	d.base.collideConnected = false;
	d.base.userData = (void*)(intptr_t)h;
	d.linearHertz = linearHertz;
	d.angularHertz = angularHertz;
	d.linearDampingRatio = damping;
	d.angularDampingRatio = damping;
	g_joints[h] = b2CreateWeldJoint(g_world, &d);
	g_jointLive[h] = 1;
	return h;
}

API void joint_destroy(int h) {
	if (h <= 0 || !g_jointLive[h]) return;
	if (b2Joint_IsValid(g_joints[h])) b2DestroyJoint(g_joints[h]);
	g_jointLive[h] = 0;
	g_jointFree[g_jointFreeN++] = h;
}

API int joint_live(int h) { return h > 0 && h < MAX_JOINTS && g_jointLive[h] && b2Joint_IsValid(g_joints[h]); }

// scratch = [fx, fy, torque]
API void joint_force(int h) {
	b2Vec2 f = b2Joint_GetConstraintForce(g_joints[h]);
	g_scratch[0] = f.x; g_scratch[1] = f.y; g_scratch[2] = b2Joint_GetConstraintTorque(g_joints[h]);
}
