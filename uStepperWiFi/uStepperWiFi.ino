#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WebSocketsServer.h>
#include <WebOTA.h>
#include "FS.h"
#include "GCode.h"
#include "constants.h"

#define UARTPORT Serial

ESP8266WebServer server(80);
WebSocketsServer websocket = WebSocketsServer(81);

GCode comm;
GCode webcomm;

const char* VERSION   = "0.1.0";
const char *ssid      = "uStepper GUI";
const char *password  = "12345679";

bool ledState             = LOW;
bool isRecording          = false;
bool playRecording        = false;
bool moreLines            = false;
char * response           = NULL;
uint8_t statusLed         = 4;
uint32_t lastPackage      = 0;
uint32_t playStepsDelay   = 0;
uint32_t previousBlink    = 0;
uint16_t recordLineCount  = 0;
uint16_t lastLine = 0;

char recordPath[]         = "/recording.txt";

struct{
  float angle = 0.0;
  float velocity = 0.0;
  int32_t steps = 0;
} tlm_data;

void setup() {
  // Init Serial port for UART communication
  UARTPORT.begin(115200);

  // Setup communication object between ESP and uStepper
  comm.setSendFunc(&uart_send);
  comm.addCommand( "DATA",    &uart_processData );
  comm.addCommand( "REACHED", &uart_lineReached );
  comm.addCommand( NULL,      &uart_default );

  // Setup communication object between webapp and ESP
  webcomm.setSendFunc(&web_send);
  webcomm.addCommand( GCODE_STOP,         &web_stop );
  webcomm.addCommand( GCODE_RECORD_START, &web_record );
  webcomm.addCommand( GCODE_RECORD_STOP,  &web_record );
  webcomm.addCommand( GCODE_RECORD_ADD,   &web_addLine );
  webcomm.addCommand( GCODE_RECORD_PLAY,  &web_record );
  webcomm.addCommand( GCODE_RECORD_PAUSE, &web_record );
  webcomm.addCommand( NULL,               &web_default );
  
  // Setup
  pinMode(statusLed, OUTPUT);
  initSPIFFS();
  webota.init(&server, "/webota");
  initWiFi();
  initWebsocket();
  initWebserver();
}

void loop() {
  websocket.loop();
  server.handleClient();

  comm.run();
  webcomm.run();

  // Feed the gcode handler serial data
  if( UARTPORT.available() > 0 )
    comm.insert( UARTPORT.read() );

  recordHandler();
  ledHandler();
}


/* 
 * --- GCode functions ---
 * Used by the GCode class to handle the different commands and send data
 */
 
void uart_send(char *data){
  UARTPORT.print(data);
}

// Return the data / command to the ESP
void uart_default(char *cmd, char *data){
  webcomm.send(data);
}


void uart_processData(char *cmd, char *data){
  // Remove "DATA" from string (such that A isn't found prematurely)
  char * values = data + strlen(cmd);
  
  comm.value("A", &tlm_data.angle, values);
  comm.value("S", &tlm_data.steps, values);
  comm.value("V", &tlm_data.velocity, values);
  
  // Send data along to webapp
  webcomm.send(data);
}

void uart_lineReached(char *cmd, char *data){
  
  if( moreLines && lastLine == recordLineCount ){

    recordLineCount++;
    playStepsDelay = millis() + 500;
    
  }
}

void web_send(char *data){
  websocket.broadcastTXT(data);
}

void web_default(char *cmd, char *data){
  // Send the packet along to uStepper
  comm.send(data);
}

void web_stop(char *cmd, char *data){
  playRecording = false;
  comm.send(data);
}

void web_addLine(char *cmd, char *data){
  char buf[50] = {'\0'};
  char tempAngle[10] = {'\0'};

  dtostrf(tlm_data.angle, 4, 2, tempAngle);
  sprintf(buf, "A%s", tempAngle);
  
  saveData(buf);
}

void web_record(char *cmd, char *data){
  if( !strcmp(cmd, GCODE_RECORD_START )){
    clearData();
    isRecording = true;
    
  }else if( !strcmp(cmd, GCODE_RECORD_STOP )){
    isRecording = false;
    playRecording = false;
    recordLineCount = 0; 
    
  }else if( !strcmp(cmd, GCODE_RECORD_PLAY )){
    if( ! playRecording )
      recordLineCount = 0; 
      
    playRecording = true;
    
  }else if( !strcmp(cmd, GCODE_RECORD_PAUSE ))
    playRecording = false;
}

/*
 * Regular functions
 */

void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t len) {
  char *data = NULL;

  if (type == WStype_TEXT) {
    data = (char *)payload;
    webcomm.insert(data);
  }
}

void recordHandler(void){
  char buf[20] = {'\0'};
  
  if(playRecording){
    // Send next line from the recording (and continue to send until reached (redundancy)
    if(millis() > playStepsDelay){

      lastLine = recordLineCount;
      moreLines = sendRecordLine();
      playStepsDelay = millis() + 250;

      if( ! moreLines ){
        playRecording = false;
        recordLineCount = 0;  
        playStepsDelay = 0;
        webcomm.send("END");        
      }else{
        // Telling the GUI which line we are at
        strcat(buf, "LINE ");
        sprintf(buf + strlen(buf), "%d", recordLineCount);
        webcomm.send(buf);
      }
    }
  }
}

void ledHandler(void){
  if (millis() - lastPackage < 500) {
    if (millis() - previousBlink >= 100) {
      previousBlink = millis();
      ledState = !ledState;
      digitalWrite(statusLed, ledState);
    }
  } else {
    if (WiFi.softAPgetStationNum() > 0) 
      digitalWrite(statusLed, LOW);
    else
      digitalWrite(statusLed, HIGH);
  }  
}

bool sendRecordLine( void ){
  File file = SPIFFS.open(recordPath, "r");
  file.setTimeout(0); // Set timeout when no newline was found (no timeout plz).

  // Buffer to load each line into
  char buf[50];
  uint8_t len = 0;

  // Read through all lines until the wanted line is reached
  for(uint16_t i = 0; i <= recordLineCount; i++){
    memset(buf, 0, sizeof(buf));
    len = file.readBytesUntil('\n', buf, sizeof(buf));
  }

  // Minimum command lenght of 2 characters, as to not send a newline by mistake
  if (len > 2){
    // Append null termination to the buffer for good measure
    buf[len] = '\0'; 
    
    char command[100] = {'\0'};
    
    strcat(command, GCODE_MOVETO);
    strcat(command, " ");
    strcat(command, buf);

    comm.send(command);

    return true;
  }

  // No more lines to be read
  return false;
  
}

void saveData(char *data) {
  // Open file and keep appending
  File f = SPIFFS.open(recordPath, "a");

  f.println(data);
  f.close();
}

void clearData( void ){
  // Open file and keep appending
  File f = SPIFFS.open(recordPath, "w");

  f.print("");
  f.close();
}

void initWebsocket(void) {
  websocket.begin();
  websocket.onEvent(webSocketEvent);
}

void initWebserver(void) {
  // Page handlers
  server.serveStatic("/", SPIFFS, "/index.html"); // Main website structure
  server.serveStatic("/assets/css/framework.css", SPIFFS, "/assets/css/framework.css"); // Responsive framework for the GUI
  server.serveStatic("/assets/css/fonticons.css", SPIFFS, "/assets/css/fonticons.css"); // Icon pack
  server.serveStatic("/assets/css/style.css", SPIFFS, "/assets/css/style.css"); // Main website style
  server.serveStatic("/assets/js/script.js", SPIFFS,"/assets/js/script.js"); // Javascript functionalities
  server.serveStatic("/assets/font/fonticons.ttf", SPIFFS,"/assets/font/fonticons.ttf"); // Javascript functionalities
  server.serveStatic("/assets/logo.png", SPIFFS,"/assets/logo.png"); // Javascript functionalities
  server.serveStatic(recordPath, SPIFFS, recordPath);
  server.on("/upload", HTTP_POST,[](){ server.send(200); }, uploadJob );
  server.begin();
}

void initWiFi(void) {
  if (!WiFi.softAP(ssid, password)) {
    Serial.println("Failed to initialise WiFi");
  }
}

void initSPIFFS(void) {
  // Begin file-system
  if (!SPIFFS.begin()) {
    Serial.println("Failed to initialise SPIFFS");
  }
}

File recordFile;

// Upload a new file to the SPIFFS
void uploadJob( void ){

  HTTPUpload& upload = server.upload();
   
  if( upload.status == UPLOAD_FILE_START){
    String filename = upload.filename;

    if( ! filename.equals("recording.txt") ){
      server.send(500, "text/plain", "Wrong filename");
      return;
    }else{
      if(!filename.startsWith("/")) filename = "/"+filename;
    
      // Open the file for writing in SPIFFS (create if it doesn't exist)
      recordFile = SPIFFS.open(filename, "w");  
    }
           
  } else if(upload.status == UPLOAD_FILE_WRITE){
    if(recordFile){
       recordFile.write(upload.buf, upload.currentSize); // Write the received bytes to the file
    }
     
  } else if(upload.status == UPLOAD_FILE_END){
    if(recordFile) { // If the file was successfully created
      recordFile.close(); // Close the file again
      server.send(303);
    } else {
      server.send(500, "text/plain", "Couldn't create file");
    }
  }
}
