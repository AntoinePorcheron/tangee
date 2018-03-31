/**
 * This is a quite simple module that handle OGame API and save retrieved data in a redis database.
 * This is also possible to retrieve data from the redis database.
 */
const https = require("https");
const redis = require("redis");
const EventEmitter = require("events");
const { parseString } = require("xml2js");
//const { promisify } = require("util"); //Not used for the moment
const redis_password = require("./redis_password");

/**
 * TODO : 
 * Refactor : 
 *            - refactor the call to the redis database, make it usable with a single redis get
 * like so : ogame_*_<class>_*.
 *            - use promises 
 *            - Correct the redis call. ( I only use get at the moment, therefore this isn't functional
 * and this should use keys before. ) <- Maybe I'm just dumb, I can rebuild properly the id with 
 * the object ID without querying on the database.
 * 
 * Setup : 
 *            - Setting up redis database.
 */

/**
 * Disclaimer : I'm not quite happy with some part ( event usage in the retrieve process for example )
 * and i'm not quite sure i've got yet the callback process, BUT I don't care for now, this will do the
 * trick for now.
 * So, if anyone is reading this, KEEP IN MIND THIS CODE CAN BE QUITE BUGGY, DON'T RELY ON IT IN ANYWAY
 * POSSIBLE.
 * Also keep in mind, i'm trying my best to comment out and to make this code clear, but if in any way 
 * possible you have an idea, a suggestion or a question about anything linked to this, you could ask 
 * me directly here : antoine.pr@live.fr
 * or add me in discord here : eratotin#8111
 */ 

/**
 * Information :
 * The ogame endpoints are the followings : 
 * player : 
 *          - IDs : players
 *	    - planets position : universe
 * 	    - player data : playerData
 * classement :
 *          - players : highscore
 *          - alliances : alliances
 * option : 
 *          - option of the server : serverData
 *          - meanings : localization //TODO : check this out
 *          - list of servers : universes
 */

/******************************************************************************************************
***                                           Event classes                                         ***
******************************************************************************************************/
class HttpEventEmitter extends EventEmitter{}
class RedisEventEmitter extends EventEmitter{}
class RetrieveEventEmitter extends EventEmitter{}
class PlayerEventEmitter extends EventEmitter{}
class AllianceEventEmitter extends EventEmitter{}
class PlanetEventEmitter extends EventEmitter{}
class MoonEventEmitter extends EventEmitter{}


/******************************************************************************************************
***                                            Global vars                                          ***
******************************************************************************************************/
let redisEventEmitter = new RedisEventEmitter();
let httpEventEmitter = new HttpEventEmitter();
let retrieveEventEmitter = new RetrieveEventEmitter();
let playerEventEmitter = new PlayerEventEmitter();
let allianceEventEmitter = new AllianceEventEmitter();
let planetEventEmitter = new PlanetEventEmitter();
let moonEventEmitter = new MoonEventEmitter();

/******************************************************************************************************
 ***                                           Error class                                          ***
 *****************************************************************************************************/

/**
 * Class that throw an error message for unimplemented function, for abstract class for example.
 */
class NotImplemented extends Error{
    constructor(){
	super();
	this.message = "This class method isn't implemented. This mean this is an abstract class.";
    }
}

/**
 * Class that warn user that an error occured while retrieving data on a redis server
 */
class RedisError extends Error{
    constructor( error ){
	super();
	this.message = `Error ${error} occured when trying to retrieve data from a redis server.`; 
    }
}

/**
 * Class that warn user that no redis client was set on the RedisObjects class.
 */
class NoRedisClientError extends Error{
    constructor(){
	super();
	this.message = "No redis client was set, so the request can't be resolved.";
    }
}

/*****************************************************************************************************
***                                         Utility function                                       ***
******************************************************************************************************/

/**
 * Function that warn if object is undefined.
 * @param object : object to test.
 * @return true if the object is undefined, false otherwise.
 */
function isUndefined( object ){
    return typeof object === typeof undefined;
}

/**
 * Function that warn if object have no keys.
 * @param object : obhect to test.
 * @return true if the object is empty, false otherwise.
 */
function isEmptyObject( object ){
    return Object.keys( object ).length === 0;
}

/**
 * Function that retrieve player from a XML datasource, and add them into a RedisObjects
 * @param xml : the XML data source.
 * @param redisObject redis objects array in which players are saved.
 */
function getPlayers(xml, redisObjects){
    let players = xml.players.player;
    players.forEach( (player)=> {
	redisObjects.push(new Player(player.$));
    });
}

/**
 * Function that retrieve alliances from a XML datasource, and add them into a RedisObjects
 */
function getAlliances(xml, redisObjects){
    let alliances = xml.alliances.alliance;
    alliances.forEach( (alliance) => {
	redisObjects.push(new Alliance(alliance.$));
    });
}

/**
 * Function that retrieve planetes from a XML datasource, and add them into a RedisObjects
 */
function getPlanets(xml, redisObjects){
    let planets = xml.universe.planet;
    planets.forEach( (planet) => {
	redisObjects.push(new Planet( planet.$, getMoonID( planet ) ));

	if ( !isUndefined( planet.moon ) )
	    redisObjects.push(new Moon( planet.moon[0].$ ) );
	
    });
}

/**
 * Function that retrieve moon id from a parsed XML of a planet
 * @param parsedXML : XML from which we want to retrieve moon ID 
 */
function getMoonID( parsedXML ){
    return ( isUndefined(parsedXML.moon) ? -1 : parsedXML.moon[0].$.id );
}

/**
 * Function that generate a redis id from a service, an attribute and an id.
 * @param service : the service used to generate the redis id.
 * @param attributes : the attribute used to generate the redis id.
 * @param id : the id used to generate the redis id.
 * @return the redis id formated as follow : ogame_<service>_<attributes>_<id>
 */
function getRedisID(service, attributes, id){
    return `ogame_${service}_${attributes}_${id}`;
}

/**
 * Function that connect to the OGame API, and save datas on the redis server.
 * @param server_id : the OGame server ID
 * @param server_country : the country identifier of the OGame server
 * @param redis_client : the redis client to the database
 */
function retrieveAPIData( server_id, server_country, callback ){
    let linkBuilder = new LinkBuilder({'id' : server_id, 'country' : server_country});
    let ogameData = new RedisObjects( redis_client );
    let count = 0;
    
    linkBuilder.target('universe');
    https.get(linkBuilder.request, (res)=>{
	let xml = "";
	res.on('data', (d) => { xml = xml + d; });
	res.on('end', () => {
	    parseString(xml, ( err, result ) => {
		getPlanets(result, ogameData);
	    });
	    httpEventEmitter.emit('end');
	});
    });

    linkBuilder.target('players');
    https.get(linkBuilder.request, (res)=>{
	let xml = "";
	res.on('data', (d) => { xml = xml + d; });
	res.on('end', () => {
	    parseString(xml, ( err, result ) => {
		getPlayers(result, ogameData);
	    });
	    httpEventEmitter.emit('end');
	});
    });
    linkBuilder.target('alliances');
    https.get(linkBuilder.request, (res)=>{
	let xml = "";
	res.on('data', (d) => { xml = xml + d; });
	res.on('end', () => {
	    parseString(xml, ( err, result ) => {
		getAlliances(result, ogameData);
	    });
	    httpEventEmitter.emit('end');
	});
    });

    httpEventEmitter.on('end', ()=>{
	++count;
	if ( count === 3 ){
	    redisEventEmitter.emit('end');
	    callback( ogameData );
	}
    });
}

/**
 * Function that retrieve the concerned ID from a redis key
 * @param redis_key : the key to parse in which we want to retrieve the ID
 * @return the id contained in the key
 */
function parseID( redis_key ){
    let parsed_key = redis_key.split('_');
    return parsed_key[parsed_key.length - 1];
}

/**
 * Retrieve planets, players and alliances data from the redis server
 * @param redis_client : the redis client to the database
 */
function retrieveRedisData( redis_client, callback ){
    let redis_objects = new RedisObjects( redis_client );
    let counter = 0;
    
    redis_client.keys('ogame_player_name_*', ( error , replies )=>{
	if ( error )
	    throw new RedisError();
	else{
	    let counter = 0;
	    replies.forEach( (reply) => {
		++counter;
		redis_objects.push(new Player({ 'id' : parseID(reply) }));
		if ( counter === reply.length - 1 )
		    redisEventEmitter.emit('retrieve');
	    });
	}
    });

    redis_client.keys('ogame_planet_name_*', ( error , replies )=>{
	if ( error )
	    throw new RedisError();
	else{
	    let counter = 0;
	    replies.forEach( (reply) => {
		++counter;
		redis_objects.push(new Planet({ 'id' : parseID(reply) }));
		if ( counter === reply.length - 1 )
		    redisEventEmitter.emit('retrieve');
	    });
	}
    });

    redis_client.keys('ogame_alliance_name_*', ( error , replies )=>{
	if ( error )
	    throw new RedisError();
	else{
	    let counter = 0;
	    replies.forEach( (reply) => {
		++counter;
		redis_objects.push(new Alliance({ 'id' : parseID(reply) }));
		if ( counter === reply.length - 1 )
		    redisEventEmitter.emit('retrieve');
	    });
	}
    });

    redis_client.keys('ogame_moon_name_*', ( error , replies )=>{
	if ( error )
	    throw new RedisError();
	else{
	    let counter = 0;
	    replies.forEach( (reply) => {
		++counter;
		redis_objects.push(new Moon({ 'id' : parseID(reply) }));
		if ( counter === reply.length - 1 )
		    redisEventEmitter.emit('retrieve');
	    });
	}
    });
    
    redisEventEmitter.on('retrieve', () => {
	++counter;
	if ( counter === 4 )
	    redis_objects.retrieve( callback );
    });
}

/******************************************************************************************************
***                                       Classes                                                   ***
******************************************************************************************************/

/**
 * Handler to save and retrieve classes easily on a redis server.
 */
class RedisObjects extends Array{
    
    constructor( redis_client ){
	super();
	
	// the redis client on which data should be saved
	this._client = redis_client;

	// Promisify the redis client get function 
	//const getAsync = promisify(this._client.get).bind(this._client);

	// Promisify the redis client keys function
	//const keysAsync = promisify(this._client.keys).bind(this._client);

	// README : 
	// I've not figure out yet how to use properly promise...
	// We'll continue to do like this for RedisObject subclass for now, but should
	// be updated.

    }

    set redisClient(redisClient){
	this._client = redisClient;
    }

    /**
     * Save all the objects on the redis database.
     */
    save(){
	if ( isUndefined( this._client ) )
	    throw new NoRedisClientError();
	else{
	    this.forEach( ( object ) => {
		object.save( this._client );
	    });
	}
    }

    /**
     * Retrieve objects from the redis database.
     * @param callback : function to call when the retrieve process is over.
     */
    retrieve( callback ){
	if ( isUndefined( this._client ) )
	    throw new NoRedisClientError();
	else{
	    let count = 0;
	    this.forEach( ( object ) => {
		object.retrieve( this._client );
		retrieveEventEmitter.on("finish", ()=>{
		    if ( count === 4 )
			callback(this);
		});
		
	    });
	}
    }
}

/**
 * Superclass for object that should be save on a redis database.
 */
class RedisObject{
    constructor(){}

    /**
     * Function that subclass must implement in order to save data on the redis database.
     */
    save( redis_client ){
	throw new NotImplemented();
    }

    /**
     * Function that subclass must implement in order to retrieve data from the redis database.
     */
    retrieve( redis_client ){
	throw new NotImplemented();
    }
}

/**
 * Subclass of RedisObject that represent an OGame player
 */
class Player extends RedisObject{
    constructor( object ){
	super();
	this._id = parseInt(object.id);
	this._name = ( isUndefined(object.name) ? '' : object.name );
	this._alliance = ( isUndefined(object.alliance) ? -1 : parseInt(object.alliance) );
	this._status = ( isUndefined(object.status) ? "op" : object.status );
	this._score = ( isUndefined(object.score) ? 0 : object.score );
    }

    get id(){
	return this._id;
    }

    get name(){
	return this._name;
    }

    get alliance(){
	return this._alliance;
    }

    get status(){
	return this._status;
    }

    get score(){
	return this._score;
    }

    set id( id ){
	this._id = id;
    }

    set name( name ){
	this._name = name;
    }

    set alliance( alliance ){
	this._alliance = alliance;
    }

    set status( status ){
	this._status = status;
    }

    set score( score ){
	this._score = score;
    }

    get redis_name(){
	return getRedisID("player", "name", this.id);
    }

    get redis_alliance(){
	return getRedisID("player", "alliance", this.id);
    }

    get redis_status(){
	return getRedisID("player", "status", this.id);
    }

    get redis_score(){
	return getRedisID("player", "score", this.id);
    }

    get redis_whole(){
	return getRedisID("player", "*", this.id);
    }

    /* OVERRIDE */
    save( redis_client ){
	redis_client.set(this.redis_name, this.name);
	redis_client.set(this.redis_alliance, this.alliance);
	redis_client.set(this.redis_status, this.status);
	redis_client.set(this.redis_score, this.score);
    }

    /* OVERRIDE */
    retrieve( redis_client ) {
	console.log("player");
	let count = 0;
	redis_client.get(this.redis_name, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.name = reply;
		playerEventEmitter.emit('retrieved');
	    }
	});

	redis_client.get(this.redis_alliance, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		playerEventEmitter.emit('retrieved');
		this.alliance = reply;
	    }
	    
	});

	redis_client.get(this.redis_status, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		playerEventEmitter.emit('retrieved');
		this.status = reply;
	    }
	});

	redis_client.get(this.redis_score, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		playerEventEmitter.emit('retrieved');
		this.score = reply;
	    }
	});

	playerEventEmitter.on('retrieved', ()=>{
	    ++count;
	    if ( count === 4 )
		retrieveEventEmitter.emit('finish');
	});
    }
}

/**
 * Subclass of RedisObject that represent an OGame alliance
 */
class Alliance extends RedisObject{
    constructor( object ){
	super();
	this._id = object.id;
	this._name = ( isUndefined(object.name) ? '' : object.name ) ;
	this._tag = ( isUndefined(object.tag) ? '' : object.tag );
	this._founder = ( isUndefined(object.founder) ? '' : object.founder );
	this.foundDate = ( isUndefined(object.foundDate) ? '' : object.foundDate );
	this._homepage = ( isUndefined(object.homepage) ? "" : object.homepage );
	this._logo = ( isUndefined(object.logo) ? "" : object.logo );
	this._isOpen = ( isUndefined(object.open) ? false : true );
    }

    get id(){
	return this._id;
    }

    get name(){
	return this._name;
    }

    get tag(){
	return this._tag;
    }

    get founder(){
	return this._founder;
    }

    get foundDate(){
	return this._foundDate;
    }

    get homepage(){
	return this._homepage;
    }

    get logo(){
	return this._logo;
    }

    get open(){
	return this._isOpen;
    }

    set name( name ){
	this._name = name;
    }

    set tag( tag ){
	this._tag = tag;
    }

    set founder( founder ){
	this._founder = founder;
    }

    set foundDate( foundDate ){
	this._foundDate = foundDate;
    }

    set homepage( homepage ){
	this._homepage = homepage;
    }

    set logo( logo ){
	this._logo = logo;
    }

    set open( open ){
	this._isOpen = open;
    }

    get redis_name(){
	return getRedisID("alliance", "name", this.id);
    }

    get redis_tag(){
	return getRedisID("alliance", "tag", this.id);
    }

    get redis_founder(){
	return getRedisID("alliance", "founder", this.id);
    }

    get redis_foundDate() {
	return getRedisID("alliance", "foundDate", this.id);
    }

    get redis_homepage(){
	return getRedisID("alliance", "homepage", this.id);
    }

    get redis_logo(){
	return getRedisID("alliance", "logo", this.id);
    }

    get redis_open(){
	return getRedisID("alliance", "open", this.id);
    }

    /* OVERRIDE */
    save( redis_client ){
	redis_client.set(this.redis_name, this.name);
	redis_client.set(this.redis_tag, this.tag);
	redis_client.set(this.redis_founder, this.founder);
	redis_client.set(this.redis_foundDate, this.foundDate);
	redis_client.set(this.redis_homepage, this.homepage);
	redis_client.set(this.redis_logo, this.logo);
	redis_client.set(this.redis_open, this.open);
    }

    /* OVERRIDE */
    retrieve( redis_client ){
	console.log("alliance");
	let count = 0;
	redis_client.get(this.redis_name, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.name = reply;
		allianceEventEmitter.emit("retrieved");
	    }
	});

	redis_client.get(this.redis_tag, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.tag = reply;
		allianceEventEmitter.emit("retrieved");
	    }
	});

	redis_client.get(this.redis_founder, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.founder = reply;
		allianceEventEmitter.emit("retrieved");
	    }
	});

	redis_client.get(this.redis_foundDate, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.foundDate = reply;
		allianceEventEmitter.emit("retrieved");
	    }
	});

	redis_client.get(this.redis_homepage, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.homepage = reply;
		allianceEventEmitter.emit("retrieved");
	    }
	});

	redis_client.get(this.redis_logo, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.logo = reply;
		allianceEventEmitter.emit("retrieved");
	    }
	});

	redis_client.get(this.redis_open, function(error, reply){
	    if ( error )
		throw new RedisError( error );
	    else{
		this.open = reply;
		allianceEventEmitter.emit("retrieved");
	    }
	});

	allianceEventEmitter.on("retrieved", ()=>{
	    ++count;
	    console.log(count);
	    if ( count === 7 )
		retrieveEventEmitter.emit('finish');
	    
	});
    }
}

/**
 * Subclass of RedisObject that represent an OGame planet
 */
class Planet extends RedisObject{
    constructor( object, moonId ){
	super();
	this._id = object.id;
	this._playerId = ( isUndefined(object.player) ? '' : object.player );
	this._name = ( isUndefined(object.name) ? '' : object.name );
	this._coords = ( isUndefined(object.coords) ? '' :  object.coords ); 
	this._moon = moonId; // I don't quite like this solution, but will do the tricks.
    }

    get id(){
	return this._id;
    }

    get player(){
	return this._playerId;
    }

    get name(){
	return this._name;
    }

    get coordinate(){
	return this._coords;
    }

    get moon(){
	return this._moon;
    }

    set id( id ){
	this._id = id;
    }

    set player( player ){
	this._playerId = player;
    }

    set name( name ){
	this._name = name;
    }

    set coordinate( coords ){
	this._coords = coords;
    }

    set moon( moon ){
	this._moon = moon;
    }

    get redis_player(){
	return getRedisID("planet", "player", this.id);
    }

    get redis_name(){
	return getRedisID("planet", "name", this.id);
    }

    get redis_coordinate(){
	return getRedisID("planet", "coordinate", this.id);
    }

    get redis_moon(){
	return getRedisID("planet", "moon", this.id);
    }

    /* OVERRIDE */
    save( redis_client ){
	redis_client.set(this.redis_player, this.name);
	redis_client.set(this.redis_name, this.name);
	redis_client.set(this.redis_coordinate, this.coordinate);
	redis_client.set(this.redis_moon, this.moon);
    }

    /* OVERRIDE */
    retrieve( redis_client ){
	console.logg("planetes");
	let count = 0;
	redis_client.get(this.redis_player, (error, reply) => {
	    if ( error )
		throw new RedisError(error);
	    else{
		this.player = reply;
		planetEventEmitter.emit('retrieved');
	    }
	});

	redis_client.get(this.redis_name, (error, reply) => {
	    if ( error )
		throw new RedisError(error);
	    else{
		this.name = reply;
		planetEventEmitter.emit('retrieved');
	    }
	});

	redis_client.get(this.redis_coordinate, (error, reply) => {
	    if ( error )
		throw new RedisError(error);
	    else{
		this.coordinate = reply;
		planetEventEmitter.emit('retrieved');
	    }
	});

	redis_client.get(this.redis_moon, (error, reply) => {
	    if ( error )
		throw new RedisError(error);
	    else{
		this.moon = reply;
		planetEventEmitter.emit('retrieved');
	    }
	});
	
	planetEventEmitter.on('retrieved', ()=>{
	    ++count;
	    if ( count === 4 )
		retrieveEventEmitter.emit('finish');
	});
    }
}

/**
 * Subclass of RedisObject that represent an OGame moon.
 */
class Moon extends RedisObject{
    constructor( object ){
	super();
	this._id = object.id;
	this._name = ( isUndefined(object.name) ? '' : object.name );
	this._size = ( isUndefined(object.size) ? '' : object.size );
    }

    get id(){
	return this._id;
    }

    get name(){
	return this._name;
    }

    get size(){
	return this._size;
    }

    set id( id ){
	this._id = id;
    }

    set name( name ){
	this._name = name;
    }

    set size( size ){
	this._size = size;
    }

    get redis_name(){
	return getRedisID("moon", "name", this.id);
    }

    get redis_size(){
	return getRedisID("moon", "size", this.id);
    }

    /* OVERRIDE */
    save( redis_client ){
	redis_client.set(this.redis_name, this.name);
	redis_client.set(this.redis_size, this.size);
    }

    /* OVERRIDE */
    retrieve( redis_client ){
	console.log("moon");
	let count = 0;
	redis_client.get(this.redis_name, (error, reply)=> {
	    if ( error )
		throw new RedisError;
	    else{
		this.name = reply;
		moonEventEmitter.emit("retrieved");
	    }
	});

	redis_client.get(this.redis_size, (error, reply)=> {
	    if ( error )
		throw new RedisError;
	    else{
		this.size = reply;
		moonEventEmitter.emit("retrieved");
	    }
	});

	moonEventEmitter.on("retrieved", ()=>{
	    ++count;
	    if ( count === 2 )
		retrieveEventEmitter.emit('finish');
	});
    }
}

/**
 * Class that create a request link to an http/https ogame API server.
 */
class LinkBuilder{
    constructor(object){
	this._id = object.id;
	this._country = object.country;
	this._params;
	this._target;
	this._protocol = ( isUndefined(object.protocol) ? 'https' : object.protocol );
    }

    /**
     * Getter to the api route.
     * Shouldn't be used outside of this class
     */
    get link(){
	return `s${this._id}-${this._country}.ogame.gameforge.com/api`;
    }

    /**
     * Getter to the api request link.
     */
    get request(){
	return `${this._protocol}://${this.link}/${this._target}.xml?${this.params}`;
    }

    /* *
     * Getter of the params formated to the get format ( arg1=val1&arg2=val2 )
     */
    get params(){
	if ( isUndefined(this._params) || isEmptyObject(this._params) )
	    return "";
	let params = "";
	Object.keys(this._params).forEach( (key) => { params += `${key}=${this._params[key]}&`; });
	return params.substring(0, params.length - 1);
    }

    /**
     * Function to set params of the request. This return the object in order to chain
     * function call.
     */
    parameters( params ){
	this._params = params;
	return this;
    }

    /**
     * Function to set the target of the request. This return the LinkBuilder in order to chain
     * function call.
     */
    target( target ) {
	this._target = target;
	return this;
    }    
}
/*****************************************************************************************************
***                                        MAIN                                                    ***
*****************************************************************************************************/

function main(){
    let redis_client = redis.createClient( { 'password' : redis_password.password } );

    /*retrieveAPIData(136, 'fr', (datas) => {
	datas.forEach( (data) => {
	    console.log(data);
	});
    });*/

    //redisEventEmitter.emit('end');

    retrieveRedisData( redis_client, ( reply ) => {
	console.log("here");
	reply.forEach( ( e ) => {
	    console.log(e);
	});
    });

    redisEventEmitter.on('end', ()=>{
	redis_client.quit();
    });
}

main();
