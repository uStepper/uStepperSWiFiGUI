/* 
 * G-Code commands 
 */

const FULLSTEPS = 200;
const MICROSTEPS = 256;
const STEPS_PER_REV = FULLSTEPS * MICROSTEPS;
const DEGREES_PER_REV = 360;
const STEP_TO_RPM = 60.0/FULLSTEPS;	// steps/s tp rpm
const RPM_TO_STEP = FULLSTEPS/60.0; // rpm to steps/s

// Move commands
const GCODE_MOVE 			= "G0";
const GCODE_MOVETO 			= "G1";
const GCODE_CONTINUOUS 		= "G2";
const GCODE_BRAKE 			= "G3";
const GCODE_HOME 			= "G4";

// Miscellaneous commands
const GCODE_STOP 			= "M0"; // Stop everything
const GCODE_SET_SPEED 		= "M1";
const GCODE_SET_ACCEL 		= "M2";
const GCODE_SET_BRAKE_FREE	= "M3";
const GCODE_SET_BRAKE_COOL 	= "M4";
const GCODE_SET_BRAKE_HARD 	= "M5";
const GCODE_SET_CL_ENABLE 	= "M6"; // Enable closed loop 
const GCODE_SET_CL_DISABLE 	= "M7"; // Disable closed loop

const GCODE_RECORD_START 	= "M10";
const GCODE_RECORD_STOP 	= "M11";
const GCODE_RECORD_ADD 		= "M12";
const GCODE_RECORD_PLAY 	= "M13";
const GCODE_RECORD_PAUSE 	= "M14";
const GCODE_REQUEST_DATA 	= "M15";
const GCODE_REQUEST_CONFIG	= "M16";


const APP_UNIT_DEGREES = 0;
const APP_UNIT_STEPS = 1;

const STEPPER_UNIT_RPM = 0;
const STEPPER_UNIT_STEP = 1;


const wsInterval = 100; 				// Min interval in ms between each command (not guaranteed)
const fileUploadURL = "/upload"; 	// Address to upload


// Websocket object to be used
var websocket;

// Telemetry returned from device
var tlm = {
	position: 0.0, 		// Angle from encoder
	absPosition: 0.0, 
	steps: 0, 			// Steps directly from driver
	absSteps: 0,
	encoderVelocity: 0.0, 
	driverVelocity: 0.0,
};

var conf = {
	velocity: 0.0,		// In steps
	acceleration: 0.0, 	// In steps/s
	brake: 0,
	closedLoop: 0,
	homeVelocity: 0.0, // In rpm 
	homeThreshold: 0,
	homeDirection: 0
};

var recording = false; 			// Flag telling if a sequence is being recorded
var playingRecording = false;
var commandAck = false; 		// Flag to check if the last sent command was completed
var commandsSend = 0; 			// Keeping track of numbers of commands sent
var requestTlm = false;
var configRead = false;
var websocketCnt = 0;
var lastVelocity = 0.0;
var currentLinenum = 0;

var positionUnit 		= APP_UNIT_DEGREES;
var velocityUnit 		= STEPPER_UNIT_RPM;
var accelerationUnit 	= STEPPER_UNIT_RPM;

// Element references to modify DOM
var statusBar 		= document.getElementById("comm-status");
var logElement 		= document.getElementById("log");
var playBtn			= document.getElementById('play');
var stopBtn			= document.getElementById('stop');
var recordBtn		= document.getElementById('record');
var recordLineBtn	= document.getElementById('recordLine');
var uploadBtn		= document.getElementById('uploadBtn');
var uploadFile		= document.getElementById('uploadFile');
var uploadForm 		= document.getElementById('uploadForm');
var homeBtn			= document.getElementById('homeBtn');
var emergencyBtn	= document.getElementById('emergencyBtn');
var linesElement	= document.getElementById('lines');
var recordingElement = document.getElementById('recording');
var dataPositionElm		= document.getElementById('dataPosition');
var dataAbsPositionElm 	= document.getElementById('dataAbsPosition');
var dataVelocityElm		= document.getElementById('dataVelocity');
var dataPositionDriverElm		= document.getElementById('dataPositionDriver');
var dataAbsPositionDriverElm	= document.getElementById('dataAbsPositionDriver');
var dataVelocityDriverElm		= document.getElementById('dataVelocityDriver');
var velocityInput 			= document.getElementById('velocityInput');
var accelerationInput 		= document.getElementById('accelerationInput');
var homeThrsInput			= document.getElementById('homeThrsInput');
var homeDirSelect			= document.getElementById('homeDirSelect')
var homeVelInput		= document.getElementById('homeVelInput')
var moveInput 			= document.getElementById('moveInput');
var moveCWBtn 			= document.getElementById('moveCWBtn');
var moveCCWBtn 			= document.getElementById('moveCCWBtn');
var anglePointer 		= document.getElementById('anglePointer');
var closedLoopCheck 	= document.getElementById('closedLoopCheck');
var posUnitSelect = document.getElementById('posunit'); 
var velUnitSelect = document.getElementById('velunit'); 
var brakeSelect = document.getElementById('brake'); 
var positionUnitElm = document.getElementsByClassName('positionUnit');
var velocityUnitElm = document.getElementsByClassName('velocityUnit');
var accelerationUnitElm = document.getElementsByClassName('accelerationUnit');
var loaderElm = document.getElementById('loader');

// Add events for selects
posUnitSelect.onchange = function(event) {
	var value = event.target.value;
	var moveunit = document.getElementById('moveInputWrapper');

	var posunit = "";

	if( value == 'degree'){
		positionUnit = APP_UNIT_DEGREES;
		moveunit.classList.remove('unit-step');
		moveunit.classList.add('unit-degree');
		posunit = "&#176;";
	}else if( value == 'step' ){
		positionUnit = APP_UNIT_STEPS;
		moveunit.classList.remove('unit-degree');
		moveunit.classList.add('unit-step');
		posunit = "step";
	}

	// Update unit labels
	for (var i = 0; i < positionUnitElm.length; i++) {
		positionUnitElm[i].innerHTML = posunit;
	}
};

// Add events for selects
velUnitSelect.onchange = function(event) {
	var value = event.target.value;

	var velUnit = "";
	var accelUnit = "";

	if( value == 'rpm' ){
		velocityUnit = STEPPER_UNIT_RPM;
		velUnit = 'rpm';
		accelUnit = 'rpm/s';
		// Update values of input fields
		velocityInput.value = (conf.velocity*STEP_TO_RPM).toFixed(2);
		accelerationInput.value = (conf.acceleration*STEP_TO_RPM).toFixed(2);
		homeVelInput.value = conf.homeVelocity;

	}else if( value == 'step' ){
		velocityUnit = STEPPER_UNIT_STEP;
		velUnit = 'step/s';
		accelUnit = 'step/s^2';
		// Update values of input fields
		velocityInput.value = conf.velocity;
		accelerationInput.value = conf.acceleration;
		homeVelInput.value = (conf.homeVelocity*RPM_TO_STEP).toFixed(2);
	}

	// Update all unit labels
	for (var i = 0; i < velocityUnitElm.length; i++) {
		velocityUnitElm[i].innerHTML = velUnit;
	}
	for (var i = 0; i < accelerationUnitElm.length; i++) {
		accelerationUnitElm[i].innerHTML = accelUnit;
	}
};

// Add events for brake method select
brakeSelect.onchange = function(event) {
	var value = event.target.value;

	switch( value ){
		case "free":
			sendCommand(GCODE_SET_BRAKE_FREE);
		break;

		case "cool":
			sendCommand(GCODE_SET_BRAKE_COOL);
		break;

		case "hard":
			sendCommand(GCODE_SET_BRAKE_HARD);
		break;
	}
};

homeVelInput.onchange = function(){
	var velocity 		= parseFloat(homeVelInput.value);
	
	if( velocityUnit == STEPPER_UNIT_RPM ){
		conf.homeVelocity = velocity.toFixed(2);
	}else if( velocityUnit == STEPPER_UNIT_STEP ){
		conf.homeVelocity = (velocity * STEP_TO_RPM).toFixed(2);
	}
}

homeDirSelect.onchange = function(){
	conf.homeDirection = parseInt(homeDirSelect.value);
}

homeThrsInput.onchange = function(){
	conf.homeThreshold = parseFloat(homeThrsInput.value).toFixed(2);
}

// Call this function when the gui is loaded
window.onload = function(){
	// Initiate the websocket connection
	initWebSocket();

	// Always try to reinitiate the Websocket connection
	setInterval(function() {
		if( websocket.readyState != 1 ){
			initWebSocket();
		}

		if( ! configRead ){
			sendCommand( GCODE_REQUEST_CONFIG );
		}
	}, 3000);

	// Read the recording 
	setInterval(function() {
		requestRecording();
	}, 250)
}

// Perform a http request from the browser
// - Used to read the contents of recording.txt on the ESP device
var xhttp = new XMLHttpRequest();

// When the http request's state has changed (request success / failure ) 
xhttp.onreadystatechange = function(){
	if (this.readyState == 4 && this.status == 200) {

		lines = this.responseText.split('\n');
		if( lines.length == 0 ){
			linesElement.innerHTML = "<span class='line'>No lines recorded</span>";
		}

		linesElement.innerHTML = '';
		for(var i = 0;i < lines.length-1;i++){

			var active = '';
			if( playingRecording && currentLinenum == i ){
				active = 'active';
			}

		    linesElement.innerHTML += "<span id='line-"+i+"' class='linenum "+active+"'>" + (i+1) + ":</span><span class='line'>" + lines[i] + "</span>";
		}

		document.getElementById('record-len').innerHTML = "("+ (lines.length-1) +")";
	}
};

// Perform a http request to read the recording
function requestRecording(){
	xhttp.open("GET", "/recording.txt", true);
	if (xhttp.readyState){
		xhttp.send();
	}
}

// When button "Upload" is clicked, open up the file selector "uploadFile"
uploadBtn.addEventListener('click', function(event){
	// Stop the button from performing any other action
	event.preventDefault()

	// Clear the file selector, and open it up
	uploadFile.value = null;
	uploadFile.click();
});

// When the file selector's state is changed (i.e. when a new file is selected)
uploadFile.onchange = function(){
	var file = this.files[0];

	// files types allowed
	var allowed_types = [ 'text/plain' ];
	if(allowed_types.indexOf(file.type) == -1) {
		alert('File: Incorrect type');
		return;
	}

	// Max 2 MB allowed
	var max_size_allowed = 2*1024*1024
	if(file.size > max_size_allowed) {
		alert('File: Exceeded size 2MB');
		return;
	}

	// Rename file
	var fileData = new FormData();
	fileData.append('file', file, 'recording.txt');

	// Send file
	var request = new XMLHttpRequest();
	request.open("POST", fileUploadURL, true);
	request.send(fileData);

	request.onload = function() {
		// Load the recording into the GUI
		requestRecording();
	}
};

// Play current recording
playBtn.onclick  = function(){
	if( playingRecording ){
		sendCommand(GCODE_RECORD_PAUSE);
		playBtn.innerHTML = '<i class="icon-play"></i>';
	}else{
		currentLinenum = 0;
		setTimeout( sendCommand(GCODE_RECORD_PLAY), 500);
		playBtn.innerHTML = '<i class="icon-pause"></i>';
	}

	playingRecording = !playingRecording;
}

stopBtn.onclick = function(){
	playingRecording = false;

	stopRecording();
}

// Add the current position/state to the recording
recordLineBtn.onclick = function(){
	sendCommand(GCODE_RECORD_ADD);

	// Request recording (update the gui)
	setTimeout( requestRecording(), 100); // Wait 100ms before reading the recording
}

// Stop ESP from recording anymore
function stopRecording()
{
	sendCommand( GCODE_RECORD_STOP );
	
	playBtn.innerHTML = '<i class="icon-play"></i>';
	recordBtn.style = "color:white";
	recording = false;
	playingRecording = false;	
}

// Home the device
homeBtn.onclick = function(){
	// Stop any on-going recording
	requestTlm = false;
	stopRecording();

	sendCommand( GCODE_HOME, [
		{name: "V", value: conf.homeVelocity},
		{name: "T", value: conf.homeThreshold},
		{name: "D", value: conf.homeDirection}
	]);
};

// Stop all operations
emergencyBtn.onclick = function(){
	// Stop any on-going recording
	stopRecording();

	sendCommand( GCODE_STOP );
};


moveCWBtn.onclick = function(){

	var step = 0;

	if( positionUnit == APP_UNIT_DEGREES)
		step = Math.round(moveInput.value * (STEPS_PER_REV/360.0));
	else
		step = Math.round(moveInput.value * MICROSTEPS);

	sendCommand( GCODE_MOVE, [{name: "A", value: step}] );

}

moveCCWBtn.onclick = function(){

	var step = 0;

	if( positionUnit == APP_UNIT_DEGREES)
		step = Math.round(moveInput.value * (STEPS_PER_REV/360.0));
	else
		step = Math.round(moveInput.value * MICROSTEPS);

	sendCommand( GCODE_MOVE, [{name: "A", value: -step}] );

}

closedLoopCheck.onchange = function(){
	var state = closedLoopCheck.checked;
	
	if( state == true ){
		sendCommand( GCODE_SET_CL_ENABLE );
	}else{
		sendCommand( GCODE_SET_CL_DISABLE );
	}
};

// Start and stop recording
recordBtn.onclick = function(){
	if(! recording ){
		sendCommand( GCODE_RECORD_START );
		recordBtn.style="color:red";
	}else{
		sendCommand( GCODE_RECORD_STOP );
		recordBtn.style="color:white";
	}
	
	// Toggle the recording state and visibility of the add line button
	recording = !recording;
	recordLineBtn.classList.toggle('d-none');
};

velocityInput.onchange = function(){
	var value = parseFloat(velocityInput.value);

	// Input velocity is in RPM
	if(velocityUnit == STEPPER_UNIT_RPM){
		conf.velocity = (value*RPM_TO_STEP).toFixed(2);

	// Input velocity is in step/s
	}else if(velocityUnit == STEPPER_UNIT_STEP){
		conf.velocity = value.toFixed(2);
	}

	sendCommand(GCODE_SET_SPEED, [{name: "A", value: conf.velocity}]);
}

accelerationInput.onchange = function(){
	var value = parseFloat(accelerationInput.value);

	// Input velocity is in RPM
	if(accelerationUnit == STEPPER_UNIT_RPM){
		conf.acceleration = (value*RPM_TO_STEP).toFixed(2);

	// Input velocity is in step/s
	}else if(accelerationUnit == STEPPER_UNIT_STEP){
		conf.acceleration = value.toFixed(2);
	}

	sendCommand(GCODE_SET_ACCEL, [{name: "A", value: conf.acceleration}]);
}

// Timer function to keep the 
var websocketInterval = function() {

    // If a connection is established
	if(websocket.readyState == 1){
		// If the configuration has been read
		if( configRead ){
			// Toggle between control command and telemetry
			if(websocketCnt === 0){
				velocity = joystickControl();

				if(velocity != lastVelocity){
					
					sendCommand( GCODE_CONTINUOUS, [{name: "A", value: velocity}] );
					
				}

				lastVelocity = velocity;

				websocketCnt = 1;
			}
			else if(websocketCnt === 1){
				if( requestTlm )
					sendCommand( GCODE_REQUEST_DATA );

				websocketCnt = 0;
			}
		}
	}

	// Set next timeout
    setTimeout(websocketInterval, wsInterval);
}

function joystickControl(){

	if(angleJoystick.isActive())
	{
		var values = angleJoystick.getRatio();

		var velocity = values.x * conf.velocity * STEP_TO_RPM;
		velocity = velocity.toFixed(2);
		
		return velocity;
	}

	return 0;
}

// Function to initialize the websocket communication
function initWebSocket(){
	// If websocket is active, close connection
	if( websocket ){
		websocket.close();
	}
	
	// Initiate the websocket object
	websocket = new WebSocket('ws://192.168.4.1:81/');

	configRead = false;
	loaderElm.classList.remove('hidden');
	addToLog("Connecting");
	setStatus("Connecting", "primary")

	// Add eventlisteners for handling communication with ESP
	websocket.onopen = function(event) { onWsOpen(event) };
	websocket.onclose = function(event) { onWsClose(event) };
	websocket.onmessage = function(event) { onWsMessage(event) };

	// Add eventlistener to close websocket before closing browser
	window.addEventListener('beforeunload', function() {
		websocket.close();
	});

	requestTlm = true;

	// Initiate timer to retry the websocket if no connection is made
	setTimeout(websocketInterval, wsInterval);
}

// Function to send a command / gcode through the websocket to the ESP
function sendCommand( command, params = [] ){
	var gcode = command;

	// If any params is to be added
	if( params.length > 0 ){
		var parameters = params.map(e => e.name + e.value ).join(' ');
		gcode += " " + parameters;
	}

	if(websocket.readyState == 1){
		console.log( "Sending: " + gcode);
		websocket.send( gcode );
		commandsSend++;
	}
}

function onWsOpen(event) {
	addToLog("Websocket connection established");
	setStatus("Connected", "success");

	loaderElm.classList.add('hidden');

	// When connection first is opened, request configuration
	sendCommand( GCODE_REQUEST_CONFIG );
}

function onWsClose(event) {
	addToLog("Websocket connection lost");
	setStatus("No connection", "danger")
}

// Whenever a message is received from the ESP
function onWsMessage(event) {
	var data = event.data;

	if( data.includes("OK")) {
		// Please send new command 
		commandAck = true;

	} else if( data.includes("DATA") ){
		var values = [];

		var items = data.split(" ");
		items.shift(); // Remove "DATA" from string

		for (var i in items) {
			// Remove the prefix of each datastring f.x. P, T and S of "TLM P20 T450 S0"
	    	values[i] = items[i].substring(1, items[i].length);
		}


		tlm.posistion 		= parseFloat(values[0])%DEGREES_PER_REV;
		tlm.absPosition 	= parseFloat(values[0]);
		tlm.steps 			= parseInt(values[1])%STEPS_PER_REV;
		tlm.absSteps		= parseInt(values[1]);
		tlm.encoderVelocity = parseFloat(values[2]);
		tlm.driverVelocity 	= parseFloat(values[3]);

		// Print values to GUI
		if( positionUnit == APP_UNIT_DEGREES ){
			dataPositionElm.value 			= tlm.posistion.toFixed(2);
			dataAbsPositionElm.value 		= tlm.absPosition.toFixed(2);
			dataPositionDriverElm.value 	= (tlm.steps/STEPS_PER_REV*DEGREES_PER_REV).toFixed(2); 	// Convert microsteps to angle
			dataAbsPositionDriverElm.value 	= (tlm.absSteps/STEPS_PER_REV*DEGREES_PER_REV).toFixed(2); 	// Convert microsteps to angle
		}else{
			dataPositionElm.value 			= (tlm.posistion.toFixed(2)/DEGREES_PER_REV*FULLSTEPS).toFixed(2); 	// Convert angle to steps
			dataAbsPositionElm.value 		= (tlm.absPosition.toFixed(2)/DEGREES_PER_REV*FULLSTEPS).toFixed(2); // Convert angle to steps
			dataPositionDriverElm.value 	= (tlm.steps/MICROSTEPS).toFixed(2);
			dataAbsPositionDriverElm.value 	= (tlm.absSteps/MICROSTEPS).toFixed(2);
		}
		var value = parseFloat(velocityInput.value);

		// Input velocity is in RPM
		if(velocityUnit == STEPPER_UNIT_RPM){
		dataVelocityElm.value 			= tlm.encoderVelocity.toFixed(2);
		dataVelocityDriverElm.value 	= tlm.driverVelocity.toFixed(2);
		}else{
		dataVelocityElm.value 			= (tlm.encoderVelocity*RPM_TO_STEP).toFixed(2);
		dataVelocityDriverElm.value 	= (tlm.driverVelocity*RPM_TO_STEP).toFixed(2);
		}

		// Animate arrow to show position
		anglePointer.style.transform 	= 'rotate('+tlm.posistion+'deg)';
	}
	else if(data.includes("CONF")){
		var values = [];

		var items = data.split(" ");
		items.shift(); // Remove "CONF" from string

		for (var i in items) {
			// Remove the prefix of each datastring
	    	values[i] = items[i].substring(1, items[i].length);
		}

		conf.velocity 		= parseFloat(values[0]).toFixed(2); // in steps/s
		conf.acceleration 	= parseFloat(values[1]).toFixed(2); // in steps/s^2
		conf.brakeMethod 	= parseInt(values[2]);
		conf.closedLoop 	= parseInt(values[3]);
		conf.homeVelocity	= parseFloat(values[4]).toFixed(2);
		conf.homeThreshold 	= parseInt(values[5]);
		conf.homeDirection 	= parseInt(values[6]);

		if( velocityUnit == STEPPER_UNIT_RPM )
			velocityInput.value = (conf.velocity*STEP_TO_RPM).toFixed(2); // Get it as RPM
		else
			velocityInput.value = conf.velocity; 

		if( velocityUnit == STEPPER_UNIT_RPM)
			accelerationInput.value = (conf.acceleration*STEP_TO_RPM).toFixed(2); // Get it as RPM/s
		else
			accelerationInput.value = conf.acceleration;

		homeVelInput.value = conf.homeVelocity;
		homeThrsInput.value = conf.homeThreshold;
		homeDirSelect.value = conf.homeDirection;

		if(configRead != true){
			addToLog( "Config received" );
		}

		configRead = true;
	}
	else if(data.includes("DONE"))
	{	
		// uStepper is done after blocking operation.
		// Safely begin request of data again
		requestTlm = true;
	}
	else if(data.includes("LINE")){
		var items = data.split(" ");
		items.shift(); // Remove "LINE" from string

		currentLinenum = parseInt(items[0]);
		console.log("Playing line: "+(currentLinenum));
	}
	else if(data.includes("END")){
		// Recording has reached its end
		playingRecording = false;
		playBtn.innerHTML = '<i class="icon-play"></i>';
	}
	else {
		console.log( "Unknown response: \"" + data + "\"");
	}
}

function addToLog( data ){
	var options = { };
	var now = new Date();

	if(logElement.value != ""){
		logElement.value += "\n";
	}

	logElement.value += now.toLocaleTimeString('en-GB', options) + ": " + data;
	logElement.scrollTop = logElement.scrollHeight;
}

function setStatus( text, type ){
	textArea = statusBar.getElementsByTagName('span')[0];
	textArea.innerHTML = text;
}

// Map function from Arduino documentation
function map(x, in_min, in_max, out_min, out_max){
	return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

// Joystick object
var angleJoystick = joystick( document.getElementById('joystick'));

// Joystick "class" 
function joystick(parent) {
	// Max lenght from center (in pixels)
	const stickWidth = 80; 

	const stick = document.createElement('div');
	stick.classList.add('joystick');

	stick.addEventListener('mousedown', handleMouseDown, { passive: true });
	document.addEventListener('mousemove', handleMouseMove);
	document.addEventListener('mouseup', handleMouseUp);

	stick.addEventListener('touchstart', handleMouseDown, { passive: true });
	document.addEventListener('touchmove', handleMouseMove);
	document.addEventListener('touchend', handleMouseUp);

	let dragStart = null;
	let active = false;
	let wrapperWidth = null;
	let currentPos = { x: 0, y: 0 };
	let currentRatio = { x: 0.0, y: 0.0 };

	function handleMouseDown(event) {
		stick.style.transition = '0s';
		if (event.changedTouches) {
			dragStart = {
				x: event.changedTouches[0].clientX,
				y: event.changedTouches[0].clientY,
			};
			return;
		}

		dragStart = {
			x: event.clientX,
			y: event.clientY,
		};

		currentPos = { x: 0, y: 0 };
		currentRatio = { x: 0, y: 0 };

		active = true;
	}

	function handleMouseMove(event) {
		if (dragStart === null) return;
		event.preventDefault(); // Prevent scroll on mobile touch of joystick

		wrapperWidth = parent.offsetWidth;

		if (event.changedTouches) {
		 	event.clientX = event.changedTouches[0].clientX;
			event.clientY = event.changedTouches[0].clientY;
		}

		const xDiff = Math.round(event.clientX - dragStart.x);
		const yDiff = Math.round(event.clientY - dragStart.y);
		const angle = Math.atan2(yDiff, xDiff);

		const lenght = Math.hypot(xDiff, yDiff);
		const maxLenght = wrapperWidth/2 - stickWidth/2;

		const distance = Math.min(maxLenght, lenght);

		var xNew = distance * Math.cos(angle);
		var yNew = distance * Math.sin(angle);

		// --- Only move X ---
		yNew = 0;

		stick.style.transform = `translate3d(${xNew}px, ${yNew}px, 0px)`;
		currentPos = { x: xNew, y: yNew };
		currentRatio = { x: xNew/maxLenght, y: yNew/maxLenght};

		active = true;
	}

	function handleMouseUp(event)
	{
		if (dragStart === null) return;

		stick.style.transition = '.2s';
		stick.style.transform = `translate3d(0px, 0px, 0px)`;
		dragStart = null;
		active = false;

		currentPos = { x: 0, y: 0 };
		currentRatio = { x: 0, y: 0 };
	}

	parent.appendChild(stick);

	return {
		getRatio: () => currentRatio,
		getPosition: () => currentPos,
		isActive: () => active,
	};
}
